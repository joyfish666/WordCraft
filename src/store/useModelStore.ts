import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelNode, SceneModel } from '../types/model'

interface ModelState {
  /** 当前场景模型（整屋根节点），null 表示空场景 */
  scene: SceneModel | null
  /** 当前选中节点 id */
  selectedId: string | null

  setScene: (scene: SceneModel) => void
  resetScene: () => void
  selectNode: (id: string | null) => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      scene: null,
      selectedId: null,

      setScene: (scene) => set({ scene, selectedId: null }),
      resetScene: () => set({ scene: null, selectedId: null }),
      selectNode: (id) => set({ selectedId: id }),
    }),
    {
      name: 'wordcraft.model',
      // 仅持久化场景，选中态无需跨会话保留
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
  const walk = (n: ModelNode): void => {
    visit(n)
    if (n.type === 'room' || n.type === 'house') {
      for (const child of n.children) walk(child)
    }
  }
  walk(scene.root)
  return found
}
