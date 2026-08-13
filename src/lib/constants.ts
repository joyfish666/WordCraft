/**
 * 跨模块共享的几何/布局常量（单一来源，避免各处硬编码漂移）。
 * 墙厚/门宽等与 roomGeometry 导出的同名常量同源（roomGeometry 改为此处再导出）。
 */

/** 几何判定通用容差（米）：贴边/共墙/浮点噪声不算重叠（坑 35/47） */
export const EPSILON = 1e-6

/** 墙厚（米）：墙体方案、嵌套房间余量、推出禁区共用 */
export const WALL_THICKNESS = 0.15

/** 邻接判定间隙容差（米）：共线且相距 ≤ 该值视为相邻（提示词邻接表/墙体共墙判定同源） */
export const ADJACENCY_GAP = 0.4

/** 门口留空净宽（米）：家具摆放避让门口通道的禁区宽度 */
export const DOOR_CLEARANCE = 1.0

/** 标准门宽（米） */
export const DOOR_WIDTH = 0.9

/** 默认层高（米）：空场景、迁移兜底、楼层高度刷新共用 */
export const DEFAULT_HEIGHT = 2.8

/** 房间贴靠落位的最小间隔（米） */
export const ROOM_SPACING = 0.3

/** 走廊型布局默认走廊宽（米） */
export const DEFAULT_CORRIDOR_WIDTH = 1.2
