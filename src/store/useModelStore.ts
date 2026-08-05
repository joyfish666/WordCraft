import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  findNodeById,
  normalizeContainment,
  updateNodeFields,
  updateNodePosition,
  walk,
  type NodeFieldsPatch,
} from '../lib/modelTree'
import type { ContainerNode, ModelNode, Position, SceneModel } from '../types/model'

/** 以不可变方式更新场景中某节点位置；root 恒为容器，故在此收窄类型 */
function withUpdatedPosition(scene: SceneModel, id: string, position: Position): SceneModel {
  return { ...scene, root: updateNodePosition(scene.root, id, position) as ContainerNode }
}

/** 撤销/重做历史栈上限：防止无界内存占用 */
const HISTORY_LIMIT = 50

/** 将旧场景压入历史（清空 future，新操作使 redo 失效）；无场景时不动 */
function pushPast(state: Pick<ModelState, 'scene' | 'past'>): Pick<ModelState, 'past' | 'future'> {
  const past = state.scene ? [...state.past, state.scene].slice(-HISTORY_LIMIT) : state.past
  return { past, future: [] }
}

interface ModelState {
  /** 当前场景模型（整屋根节点），null 表示空场景 */
  scene: SceneModel | null
  /** 当前选中节点 id */
  selectedId: string | null
  /** 聚焦容器 id（点击房间进入其内部视图，null 表示整屋视图） */
  focusId: string | null
  /** 移动步长（米） */
  stepSize: number
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

  /** 按增量移动选中模块（每次调用为一个可撤销步骤） */
  translateSelected: (dx: number, dy: number, dz: number) => void
  /** 将选中模块位置复位到加载时的初始位置（可撤销） */
  resetSelectedPosition: () => void
  /** 按补丁更新选中节点（名称/尺寸/位置），提交后约束进墙内并记入历史 */
  updateSelected: (patch: NodeFieldsPatch) => void
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
      initialPositions: {},
      past: [],
      future: [],

      setScene: (scene) => {
        // 先将家具约束在墙内（避免与墙/门重叠），再快照初始位置用于后续复位
        const normalized = normalizeContainment(scene)
        const initialPositions: Record<string, Position> = {}
        walk(normalized.root, (n) => {
          initialPositions[n.id] = n.position
        })
        // 新模型取代旧场景：清空编辑历史，避免撤销回到被替换的旧模型
        set({ scene: normalized, selectedId: null, focusId: null, initialPositions, past: [], future: [] })
      },

      resetScene: () =>
        set({ scene: null, selectedId: null, focusId: null, initialPositions: {}, past: [], future: [] }),
      selectNode: (id) => set({ selectedId: id }),
      setFocus: (id) => set({ focusId: id }),
      setStepSize: (step) => set({ stepSize: step }),

      translateSelected: (dx, dy, dz) =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const target = findNodeById(state.scene.root, state.selectedId)
          if (!target) return state
          const next: Position = {
            x: target.position.x + dx,
            y: target.position.y + dy,
            z: target.position.z + dz,
          }
          return { scene: withUpdatedPosition(state.scene, state.selectedId, next), ...pushPast(state) }
        }),

      resetSelectedPosition: () =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const original = state.initialPositions[state.selectedId]
          if (!original) return state
          return { scene: withUpdatedPosition(state.scene, state.selectedId, original), ...pushPast(state) }
        }),

      updateSelected: (patch) =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          // root 恒为容器，故此处收窄类型
          const nextRoot = updateNodeFields(state.scene.root, state.selectedId, patch) as ContainerNode
          if (nextRoot === state.scene.root) return state // 无实际变化（空补丁/未命中），不记历史
          // 提交后重新约束进墙内，并把变化后的场景作为新状态
          const scene = normalizeContainment({ ...state.scene, root: nextRoot })
          return { scene, ...pushPast(state) }
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
  const visit = (n: ModelNode): void => {
    if (n.id === selectedId) found = n
  }
  const dfs = (n: ModelNode): void => {
    visit(n)
    if (n.type === 'room' || n.type === 'house') {
      for (const child of n.children) dfs(child)
    }
  }
  dfs(scene.root)
  return found
}
