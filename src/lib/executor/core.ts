import { applyFurnitureConventions } from '../furniturePlacement'
import { DEFAULT_HEIGHT } from '../constants'
import { normalizeContainment } from '../modelTree'
import type { Op } from '../../types/ops'
import type { SceneModel } from '../../types/model'
import { refreshLevelHeight } from './shared'
import {
  applyAddAdjacency,
  applyAddRoom,
  applyMacro,
  applyMergeRoom,
  applyMoveRoom,
  applyNestRoom,
  applyRemoveRoom,
  applySetHouse,
  applySplitRoom,
  applyUpdateRoom,
} from './rooms'
import { applyAddFurniture, applyRemoveFurniture, applyUpdateFurniture } from './furniture'
import { applySetOpenings } from './openings'

/** 空场景（尚无整屋时的起点，供生成链路使用） */
export function emptyScene(name = '未命名房屋'): SceneModel {
  return {
    version: 3,
    root: {
      id: 'house1',
      type: 'house',
      name,
      levels: [{ id: 'level-house1', height: DEFAULT_HEIGHT, rooms: [] }],
    },
  }
}

export interface ExecuteResult {
  scene: SceneModel
  applied: number
  skipped: string[]
}

/** 执行一批操作：逐条容错，结束统一约束；返回最终场景与失败明细 */
export function executeOps(
  scene: SceneModel,
  ops: Op[],
  options?: { furnitureConventions?: boolean },
): ExecuteResult {
  let current = scene
  const skipped: string[] = []
  let applied = 0
  for (const op of ops) {
    // 防御：运行时数据（分享口令/迁移等外部输入）可能含 null/非对象条目，
    // 先安全取操作名，避免 catch 内二次解引用 op.op 导致整批崩溃。
    const opName = op && typeof op === 'object' ? String((op as { op?: unknown }).op ?? '?') : '?'
    try {
      current = applyOp(current, op)
      applied++
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      skipped.push(`第 ${applied + skipped.length + 1} 条 ${opName}: ${detail}`)
    }
  }
  let result = normalizeContainment(current)
  // 生成时常理兜底（auto 模板批次）：贴墙摆放 + 避让禁区（resolveLayout 对 macro auto 已跑，此处幂等）
  if (options?.furnitureConventions) {
    result = applyFurnitureConventions(result)
    result = normalizeContainment(result)
  }
  result = refreshLevelHeight(result)
  return { scene: result, applied, skipped }
}

/** 执行单条操作；失败抛错（由 executeOps 捕获跳过），成功返回新场景 */
export function applyOp(scene: SceneModel, op: Op): SceneModel {
  switch (op.op) {
    case 'setHouse':
      return applySetHouse(scene, op)
    case 'macro':
      return applyMacro(scene, op)
    case 'addRoom':
      return applyAddRoom(scene, op)
    case 'updateRoom':
      return applyUpdateRoom(scene, op)
    case 'removeRoom':
      return applyRemoveRoom(scene, op)
    case 'moveRoom':
      return applyMoveRoom(scene, op)
    case 'nestRoom':
      return applyNestRoom(scene, op)
    case 'splitRoom':
      return applySplitRoom(scene, op)
    case 'mergeRoom':
      return applyMergeRoom(scene, op)
    case 'addFurniture':
      return applyAddFurniture(scene, op)
    case 'updateFurniture':
      return applyUpdateFurniture(scene, op)
    case 'removeFurniture':
      return applyRemoveFurniture(scene, op)
    case 'setOpenings':
      return applySetOpenings(scene, op)
    case 'addAdjacency':
      return applyAddAdjacency(scene, op)
    default:
      // 防御：schema 之外的 op 名（运行时脏数据）必须显式失败，
      // 否则隐式返回 undefined 会污染 current 使整批后续 op 全部失败。
      throw new Error(`未知操作: ${String((op as { op?: unknown }).op)}`)
  }
}
