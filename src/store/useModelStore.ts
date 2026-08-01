import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { findNodeById, updateNodePosition, walk } from '../lib/modelTree'
import type { ContainerNode, ModelNode, Position, SceneModel } from '../types/model'

/** 以不可变方式更新场景中某节点位置；root 恒为容器，故在此收窄类型 */
function withUpdatedPosition(scene: SceneModel, id: string, position: Position): SceneModel {
  return { ...scene, root: updateNodePosition(scene.root, id, position) as ContainerNode }
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

  setScene: (scene: SceneModel) => void
  resetScene: () => void
  selectNode: (id: string | null) => void
  setFocus: (id: string | null) => void
  setStepSize: (step: number) => void

  /** 按增量移动选中模块 */
  translateSelected: (dx: number, dy: number, dz: number) => void
  /** 将选中模块位置复位到加载时的初始位置 */
  resetSelectedPosition: () => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      scene: null,
      selectedId: null,
      focusId: null,
      stepSize: 0.5,
      initialPositions: {},

      setScene: (scene) => {
        // 快照所有节点初始位置，用于后续复位
        const initialPositions: Record<string, Position> = {}
        walk(scene.root, (n) => {
          initialPositions[n.id] = n.position
        })
        set({ scene, selectedId: null, focusId: null, initialPositions })
      },

      resetScene: () => set({ scene: null, selectedId: null, focusId: null, initialPositions: {} }),
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
          return { scene: withUpdatedPosition(state.scene, state.selectedId, next) }
        }),

      resetSelectedPosition: () =>
        set((state) => {
          if (!state.scene || !state.selectedId) return state
          const original = state.initialPositions[state.selectedId]
          if (!original) return state
          return { scene: withUpdatedPosition(state.scene, state.selectedId, original) }
        }),
    }),
    {
      name: 'wordcraft.model',
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
