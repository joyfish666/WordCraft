import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SceneModel } from '../types/model'

interface ProjectState {
  /** 当前场景所属项目的 id；null 表示当前场景未关联任何项目（新生成的游离场景） */
  currentId: number | null
  /** 当前项目名称（保存/重命名时同步，仅展示用） */
  currentName: string | null
  /** 当前项目自上次保存后是否有未保存修改（会话内状态，不持久化） */
  dirty: boolean
  /** 上次保存时的场景快照（JSON）；脏判定与 savedJson 比对（会话内状态，不持久化） */
  savedJson: string | null

  /** 打开项目 / 保存为新项目后绑定，并清空脏标记 */
  setProject: (id: number, name: string) => void
  /** 生成新场景 / 加载示例 / 清空场景时解绑（新场景不属于任何项目） */
  clearProject: () => void
  /** 重命名当前项目时同步名称（不改变脏标记） */
  setCurrentName: (name: string) => void
  markSaved: () => void
  markDirty: () => void
  /** 以当前场景快照作为「已保存」基线（保存/打开/创建项目后调用），同时清空脏标记 */
  commitSavedScene: (sceneJson: string | null) => void
}

/**
 * 当前项目状态：记录"当前场景属于哪个项目"，供保存/切换/未保存守卫使用。
 * 只持久化 currentId/currentName，使刷新后仍能关联当前项目；dirty 为会话内状态。
 * 脏标记收敛于此（坑 B7）：savedJson 快照 + dirty 布尔；高频场景更新（Gizmo/平面图拖拽预览）
 * 只把 dirty 置真，不逐帧 stringify——「干净 → 场景变化」与撤销回已保存状态时才做一次全量比对。
 */
export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentId: null,
      currentName: null,
      dirty: false,
      savedJson: null,

      setProject: (id, name) => set({ currentId: id, currentName: name, dirty: false }),
      clearProject: () =>
        set({ currentId: null, currentName: null, dirty: false, savedJson: null }),
      setCurrentName: (name) => set({ currentName: name }),
      markSaved: () => set({ dirty: false }),
      markDirty: () => set({ dirty: true }),
      commitSavedScene: (sceneJson) => set({ savedJson: sceneJson, dirty: false }),
    }),
    {
      name: 'wordcraft.project',
      partialize: (s) => ({ currentId: s.currentId, currentName: s.currentName }),
    },
  ),
)

/**
 * 场景变化后与已保存快照比对（离散操作专用：撤销/重做等一次性的整场景切换）。
 * 已脏 / 无项目时不比对（拖拽预览等高频路径由 useModelStore 直接置脏，不走到这里）。
 * 比对相等说明撤销回到了已保存状态，清除脏标记。
 */
export function syncDirtyWithSaved(scene: SceneModel | null): void {
  const { dirty, savedJson, currentId } = useProjectStore.getState()
  if (!dirty || currentId === null) return
  const json = scene ? JSON.stringify(scene) : null
  if (json === savedJson) useProjectStore.getState().markSaved()
}
