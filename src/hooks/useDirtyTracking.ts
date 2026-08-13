import { useEffect } from 'react'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import type { SceneModel } from '../types/model'

/**
 * 项目库脏标记（坑 B7 收敛到 useProjectStore，HomePage 抽离）：
 * - 首帧场景作为「已保存」基线（挂载/持久化重载视为已保存，避免误标脏）；
 * - 场景变化订阅只在「干净 → 变化」时做一次快照比对——拖拽等高频预览更新
 *   （previewSelected/previewFootprint 每帧换 scene 引用）不逐帧 stringify；
 * - 撤销/重做回到已保存状态由 useModelStore 的 undo/redo 调 syncDirtyWithSaved 一次性清除。
 */
export function useDirtyTracking(scene: SceneModel | null): void {
  useEffect(() => {
    // 首帧基线：挂载时若已有项目但无快照（如持久化重载），以当前场景为准
    const ps = useProjectStore.getState()
    if (ps.currentId !== null && ps.savedJson === null && scene !== null) {
      ps.commitSavedScene(JSON.stringify(scene))
    }
    // 基线只在挂载时取一次（scene 初始值即可）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return useModelStore.subscribe((state, prev) => {
      if (state.scene === prev.scene) return
      const ps = useProjectStore.getState()
      if (ps.currentId === null) return
      // 已脏时跳过（拖拽期间每帧变化只置脏一次，不逐帧比对）
      if (ps.dirty) return
      const json = state.scene ? JSON.stringify(state.scene) : null
      if (json === ps.savedJson) ps.markSaved()
      else ps.markDirty()
    })
  }, [])
}
