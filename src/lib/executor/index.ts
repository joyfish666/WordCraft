/**
 * 执行器门面（原 executor.ts 拆分，2026-08-13 工程批次）：
 * - core.ts     —— executeOps / applyOp / emptyScene
 * - rooms.ts    —— 整屋与房间操作（setHouse/macro/add/update/remove/move/nest/split/merge/addAdjacency）
 * - furniture.ts—— 家具操作
 * - openings.ts —— 开洞（门/窗）
 * - diff.ts     —— v2 整屋快照 → ops diff（容错路径）
 * - shared.ts   —— 树操作辅助与缺省尺寸常量
 */
export { applyOp, emptyScene, executeOps, type ExecuteResult } from './core'
export { DEFAULT_FURNITURE_DIMS, DEFAULT_ROOM_DIMS, DEFAULT_WINDOW_WIDTH, findRoom } from './shared'
export { diffSceneV2 } from './diff'
