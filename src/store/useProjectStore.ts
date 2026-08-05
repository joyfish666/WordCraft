import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ProjectState {
  /** 当前场景所属项目的 id；null 表示当前场景未关联任何项目（新生成的游离场景） */
  currentId: number | null
  /** 当前项目名称（保存/重命名时同步，仅展示用） */
  currentName: string | null
  /** 当前项目自上次保存后是否有未保存修改（会话内状态，不持久化） */
  dirty: boolean

  /** 打开项目 / 保存为新项目后绑定，并清空脏标记 */
  setProject: (id: number, name: string) => void
  /** 生成新场景 / 加载示例 / 清空场景时解绑（新场景不属于任何项目） */
  clearProject: () => void
  /** 重命名当前项目时同步名称（不改变脏标记） */
  setCurrentName: (name: string) => void
  markSaved: () => void
  markDirty: () => void
}

/**
 * 当前项目状态：记录"当前场景属于哪个项目"，供保存/切换/未保存守卫使用。
 * 只持久化 currentId/currentName，使刷新后仍能关联当前项目；dirty 为会话内状态。
 */
export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentId: null,
      currentName: null,
      dirty: false,

      setProject: (id, name) => set({ currentId: id, currentName: name, dirty: false }),
      clearProject: () => set({ currentId: null, currentName: null, dirty: false }),
      setCurrentName: (name) => set({ currentName: name }),
      markSaved: () => set({ dirty: false }),
      markDirty: () => set({ dirty: true }),
    }),
    {
      name: 'wordcraft.project',
      partialize: (s) => ({ currentId: s.currentId, currentName: s.currentName }),
    },
  ),
)
