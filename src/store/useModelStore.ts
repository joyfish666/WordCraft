import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { editDiffToOps } from '../lib/editOps'
import { executeOps } from '../lib/executor'
import { nodePosition } from '../lib/footprint'
import { migrateModel } from '../lib/migration'
import {
  findNodeById,
  normalizeContainment,
  updateNodeFields,
  updateNodeFootprint,
  updateNodePosition,
  walk,
  type NodeFieldsPatch,
} from '../lib/modelTree'
import type { ModelNode, Point2D, Position, SceneModel } from '../types/model'
import type { Op } from '../types/ops'
import { useChatStore } from './useChatStore'

/** 以不可变方式更新场景中某节点位置；root 恒为整屋，故在此收窄类型 */
function withUpdatedPosition(scene: SceneModel, id: string, position: Position): SceneModel {
  return { ...scene, root: updateNodePosition(scene.root, id, position) as SceneModel['root'] }
}

/** 撤销/重做历史栈上限：防止无界内存占用 */
const HISTORY_LIMIT = 50

/** 将旧场景压入历史（清空 future，新操作使 redo 失效）；无场景时不动 */
function pushPast(state: Pick<ModelState, 'scene' | 'past'>): Pick<ModelState, 'past' | 'future'> {
  const past = state.scene ? [...state.past, state.scene].slice(-HISTORY_LIMIT) : state.past
  return { past, future: [] }
}

/**
 * 双向同步（design.md §5.1）：手动编辑提交后，把「编辑前 → 编辑后」diff 成一条
 * 与对话同构的 op 追加进 useChatStore 的编辑日志（供多轮对话上下文）；无实际变化不记录。
 */
function recordEditOps(before: SceneModel, after: SceneModel, id: string): void {
  const ops = editDiffToOps(before, after, id)
  if (ops.length > 0) useChatStore.getState().pushEditOps(ops)
}

/** 平面图编辑工具（P4，design.md §6）：会话内状态，不持久化 */
export type PlanTool = 'select' | 'move' | 'vertex' | 'opening' | 'split' | 'merge'

interface ModelState {
  /** 当前场景模型（整屋根节点），null 表示空场景 */
  scene: SceneModel | null
  /** 当前选中节点 id */
  selectedId: string | null
  /** 聚焦容器 id（点击房间进入其内部视图，null 表示整屋视图） */
  focusId: string | null
  /** 移动步长（米） */
  stepSize: number
  /** Gizmo 手柄模式：移动 / 缩放（会话内，不持久化） */
  gizmoMode: 'translate' | 'scale'
  /** 平面图编辑工具（P4：选择/移动/顶点/门窗/拆房/合并，会话内不持久化） */
  planTool: PlanTool
  /** 门窗工具的放置种类（会话内不持久化） */
  openingKind: 'door' | 'window'
  /** 截图瞬间隐藏辅助元素（网格/选中框/手柄/标注），会话内不持久化 */
  screenshotMode: boolean
  /** 场景加载时的各节点初始位置，用于「复位」 */
  initialPositions: Record<string, Position>
  /** 撤销历史栈（较旧的场景快照，不含当前 scene），不持久化 */
  past: SceneModel[]
  /** 重做历史栈，不持久化 */
  future: SceneModel[]

  setScene: (scene: SceneModel) => void
  resetScene: () => void
  selectNode: (id: string | null) => void
  setFocus: (id: string | null) => void
  setStepSize: (step: number) => void
  setGizmoMode: (mode: 'translate' | 'scale') => void
  setPlanTool: (tool: PlanTool) => void
  setOpeningKind: (kind: 'door' | 'window') => void
  setScreenshotMode: (v: boolean) => void

  /** 按增量移动选中模块（每次调用为一个可撤销步骤） */
  translateSelected: (dx: number, dy: number, dz: number) => void
  /** 将选中模块位置复位到加载时的初始位置（可撤销） */
  resetSelectedPosition: () => void
  /** 按补丁更新选中节点（名称/尺寸/位置），提交后约束进墙内并记入历史 */
  updateSelected: (patch: NodeFieldsPatch) => void
  /** Gizmo 拖拽实时预览：更新选中节点位置/尺寸，不记历史、不约束（避免每帧刷撤销栈与约束回弹） */
  previewSelected: (patch: NodeFieldsPatch) => void
  /** 平面图顶点拖拽实时预览：直接替换房间足迹，不记历史、不约束 */
  previewFootprint: (id: string, footprint: Point2D[]) => void
  /** Gizmo 拖拽结束：把拖拽前的 baseScene 压入撤销栈（若确有变化），并对当前场景约束进墙内 */
  commitDrag: (baseScene: SceneModel | null) => void
  /** 平面图编辑提交（非拖拽类：放门窗/拆房/合并）：执行 ops → 记历史 → 追加编辑日志 */
  applyPlanOps: (ops: Op[]) => void
  /** 平面图拖拽结束：同 commitDrag，但以指定 id 生成编辑日志（供拖顶点/拖房间用） */
  commitPlanEdit: (baseScene: SceneModel | null, id: string) => void
  /** 撤销最近一次编辑 */
  undo: () => void
  /** 重做最近一次撤销 */
  redo: () => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      scene: null,
      selectedId: null,
      focusId: null,
      stepSize: 0.5,
      gizmoMode: 'translate',
      planTool: 'select',
      openingKind: 'door',
      screenshotMode: false,
      initialPositions: {},
      past: [],
      future: [],

      setScene: (scene) => {
        // 先将家具约束在墙内（避免与墙/门重叠），再快照初始位置用于后续复位
        const normalized = normalizeContainment(scene)
        const initialPositions: Record<string, Position> = {}
        walk(normalized.root, (n) => {
          initialPositions[n.id] = nodePosition(n)
        })
        // 新模型取代旧场景：清空编辑历史，避免撤销回到被替换的旧模型
        set({ scene: normalized, selectedId: null, focusId: null, initialPositions, past: [], future: [], planTool: 'select' })
        // 场景被整体替换（生成/打开项目/加载示例/口令还原）：旧的编辑日志描述的是已不存在的前一场景
        useChatStore.getState().clearEditOps()
      },

      resetScene: () => {
        set({ scene: null, selectedId: null, focusId: null, initialPositions: {}, past: [], future: [], planTool: 'select' })
        useChatStore.getState().clearEditOps()
      },
      selectNode: (id) => set({ selectedId: id }),
      setFocus: (id) => set({ focusId: id }),
      setStepSize: (step) => set({ stepSize: step }),
      setGizmoMode: (mode) => set({ gizmoMode: mode }),
      setPlanTool: (tool) => set({ planTool: tool }),
      setOpeningKind: (kind) => set({ openingKind: kind }),
      setScreenshotMode: (v) => set({ screenshotMode: v }),

      translateSelected: (dx, dy, dz) =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const target = findNodeById(state.scene.root, state.selectedId)
          if (!target) return state
          const cur = nodePosition(target)
          const next: Position = {
            x: cur.x + dx,
            y: cur.y + dy,
            z: cur.z + dz,
          }
          const scene = withUpdatedPosition(state.scene, state.selectedId, next)
          recordEditOps(state.scene, scene, state.selectedId)
          return { scene, ...pushPast(state) }
        }),

      resetSelectedPosition: () =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const original = state.initialPositions[state.selectedId]
          if (!original) return state
          const scene = withUpdatedPosition(state.scene, state.selectedId, original)
          recordEditOps(state.scene, scene, state.selectedId)
          return { scene, ...pushPast(state) }
        }),

      updateSelected: (patch) =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const nextRoot = updateNodeFields(state.scene.root, state.selectedId, patch) as SceneModel['root']
          if (nextRoot === state.scene.root) return state // 无实际变化（空补丁/未命中），不记历史
          // 提交后重新约束进墙内，并把变化后的场景作为新状态
          const scene = normalizeContainment({ ...state.scene, root: nextRoot })
          recordEditOps(state.scene, scene, state.selectedId)
          return { scene, ...pushPast(state) }
        }),

      previewSelected: (patch) =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const nextRoot = updateNodeFields(state.scene.root, state.selectedId, patch) as SceneModel['root']
          if (nextRoot === state.scene.root) return state // 无实际变化，不产生新引用
          // 拖拽中不约束、不记历史（结束时由 commitDrag 统一约束 + 记一次历史）
          return { scene: { ...state.scene, root: nextRoot } }
        }),

      previewFootprint: (id, footprint) =>
        set((state) => {
          if (!state.scene) return state
          const nextRoot = updateNodeFootprint(state.scene.root, id, footprint) as SceneModel['root']
          if (nextRoot === state.scene.root) return state
          // 顶点拖拽中不约束、不记历史（结束时由 commitPlanEdit 统一处理）
          return { scene: { ...state.scene, root: nextRoot } }
        }),

      commitDrag: (baseScene) =>
        set((state) => {
          if (!state.scene || !baseScene || state.scene === baseScene) return state // 无场景 / 拖拽无变化
          const before: SceneModel = baseScene // 收窄非空（参数窄化不进入闭包）
          // 拖拽前的场景作为历史快照；当前场景约束进墙内作为新状态
          const scene = normalizeContainment(state.scene)
          if (state.selectedId) recordEditOps(before, scene, state.selectedId)
          return { scene, ...pushPast({ scene: before, past: state.past }) }
        }),

      applyPlanOps: (ops) =>
        set((state) => {
          if (!state.scene || ops.length === 0) return state
          const result = executeOps(state.scene, ops)
          if (result.applied === 0) return state
          if (JSON.stringify(result.scene) === JSON.stringify(state.scene)) return state // 无实际变化
          useChatStore.getState().pushEditOps(ops)
          return { scene: result.scene, ...pushPast(state) }
        }),

      commitPlanEdit: (baseScene, id) =>
        set((state) => {
          if (!state.scene || !baseScene || state.scene === baseScene) return state
          const before: SceneModel = baseScene
          // 拖拽前的场景作为历史快照；当前场景约束进墙内作为新状态（与 commitDrag 同行为）
          const scene = normalizeContainment(state.scene)
          recordEditOps(before, scene, id)
          return { scene, ...pushPast({ scene: before, past: state.past }) }
        }),

      undo: () =>
        set((state) => {
          if (state.past.length === 0) return state
          const previous = state.past[state.past.length - 1]
          const future = state.scene ? [...state.future, state.scene].slice(-HISTORY_LIMIT) : state.future
          return { scene: previous, past: state.past.slice(0, -1), future }
        }),

      redo: () =>
        set((state) => {
          if (state.future.length === 0) return state
          const next = state.future[state.future.length - 1]
          const past = state.scene ? [...state.past, state.scene].slice(-HISTORY_LIMIT) : state.past
          return { scene: next, past, future: state.future.slice(0, -1) }
        }),
    }),
    {
      name: 'wordcraft.model',
      // 只持久化场景；历史栈为会话内状态，刷新后清空
      partialize: (state) => ({ scene: state.scene }),
      // v3 数据模型：旧持久化数据（v1 盒子模型）读取时迁移（notes §5.2 迁移必须幂等）
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { scene?: unknown }
        return { ...state, scene: state.scene ? migrateModel(state.scene) : state.scene }
      },
    },
  ),
)

/** 选中节点类型辅助：供组件层以纯函数方式从 store 派生 */
export function getSelectedNode(
  scene: SceneModel | null,
  selectedId: string | null,
): ModelNode | null {
  if (!scene || !selectedId) return null
  let found: ModelNode | null = null
  const dfs = (n: ModelNode): void => {
    if (n.id === selectedId) {
      found = n
      return
    }
    if (n.type === 'house') {
      for (const level of n.levels) {
        for (const room of level.rooms) dfs(room)
      }
    } else if (n.type === 'room') {
      for (const f of n.furniture) dfs(f)
      for (const r of n.nestedRooms) dfs(r)
    }
  }
  dfs(scene.root)
  return found
}
