import { furnitureKind, type FurnitureKind } from './furniturePresets'
import { createId } from './id'
import type { Dimensions, FurnitureNode, RoomNode } from '../types/model'

/**
 * 家具常配套件补全（坑 87，2026-08-13）：
 * 生成链路的兜底——LLM 输出家具清单经常漏配常配套件（书房有书桌没椅子、
 * 卧室有床没床头柜），提示词再强调也依赖遵循度。这里按"硬配套"规则补全：
 * - 书桌/梳妆台 → 使用者侧补 1 把椅子；
 * - 餐桌/圆桌 → 两侧补 2 把餐椅；
 * - 床 → 床头两侧补 2 个床头柜；
 * - 沙发 → 前方补 1 个茶几。
 *
 * **用户要求优先级最高**：用户明确不要时，把排除写进该房间任一家具的 `description`
 * （如 "不要椅子"、"无需床头柜"），本房间整体跳过补全（提示词已说明该通道）。
 * 已有同类家具时不重复补（幂等：applyFurnitureConventions 可能跑两轮）。
 *
 * 补全件使用 LLM 给定家具的当前位置推导初始坐标（绝对坐标），最终位置由
 * applyFurnitureConventions 的摆放流程（贴墙/避让/约束进墙）确定。
 */

/** 椅子（书桌/梳妆台/餐桌配套）：0.45×0.45，高 0.8 */
const CHAIR_DIMS: Dimensions = { length: 0.45, width: 0.45, height: 0.8 }
/** 床头柜：0.45×0.4，高 0.5 */
const NIGHTSTAND_DIMS: Dimensions = { length: 0.45, width: 0.4, height: 0.5 }
/** 茶几（沙发配套）：1.2×0.6，高 0.45 */
const COFFEE_TABLE_DIMS: Dimensions = { length: 1.2, width: 0.6, height: 0.45 }
/** 配套件与主家具的间距（米）：人坐的余量 / 床头柜间隙 */
const SEAT_GAP = 0.35
/** 书桌/梳妆台/沙发：配套件放在"使用者侧"（背侧的反方向）的偏移 */
const FRONT_GAP = 0.6

/** 用户明确排除配套的关键词（写在房间任一家具的 description 里，命中整房间跳过补全） */
const EXCLUDE_RE = /不要|不配|不需要|无需|无须|去掉|去除|免配|免了|别放|不加|不设|免置/

/** 房间家具描述里是否出现明确排除配套的意图（用户要求优先级最高的通道） */
export function hasExcludedCompleteness(room: RoomNode): boolean {
  return room.furniture.some(
    (f) => f.description !== undefined && f.description !== '' && EXCLUDE_RE.test(f.description),
  )
}

/** 构造补全家具（v3 绝对坐标；y 为高度一半，底面贴地，同 v2 语义） */
function makeFurniture(name: string, dimensions: Dimensions, x: number, z: number): FurnitureNode {
  return {
    id: createId(),
    type: 'furniture',
    name,
    dimensions,
    position: { x, y: dimensions.height / 2, z },
  }
}

/**
 * 房间家具配套补全：返回补全后的清单（无补全时返回原数组引用，便于调用方短路）。
 * 只做"缺了就补"的硬配套；摆放位置交给 applyFurnitureConventions 的常理摆放流程。
 */
export function completeRoomFurniture(room: RoomNode): FurnitureNode[] {
  const furniture = room.furniture
  if (furniture.length === 0 || hasExcludedCompleteness(room)) return furniture
  const kinds = new Set<FurnitureKind>(furniture.map((f) => furnitureKind(f.name)))
  const has = (k: FurnitureKind): boolean => kinds.has(k)
  const additions: FurnitureNode[] = []
  const push = (f: FurnitureNode): void => {
    additions.push(f)
    kinds.add(furnitureKind(f.name))
  }

  for (const f of furniture) {
    const kind = furnitureKind(f.name)
    // 书桌/梳妆台：使用者侧（背侧反方向，桌/台背面朝墙时椅子自然落在房间中部）补椅子
    if ((kind === 'desk' || kind === 'dressingTable') && !has('chair')) {
      push(makeFurniture('椅子', CHAIR_DIMS, f.position.x, f.position.z - FRONT_GAP))
    }
    // 餐桌/圆桌：两侧补餐椅（圆桌直径两侧、餐桌长边两侧）
    if ((kind === 'table' || kind === 'roundTable') && !has('chair')) {
      const alongX = kind === 'roundTable' || f.dimensions.length >= f.dimensions.width
      const half =
        kind === 'roundTable'
          ? f.dimensions.length / 2
          : Math.max(f.dimensions.length, f.dimensions.width) / 2
      const off = half + SEAT_GAP
      if (alongX) {
        push(makeFurniture('餐椅', CHAIR_DIMS, f.position.x - off, f.position.z))
        push(makeFurniture('餐椅', CHAIR_DIMS, f.position.x + off, f.position.z))
      } else {
        push(makeFurniture('餐椅', CHAIR_DIMS, f.position.x, f.position.z - off))
        push(makeFurniture('餐椅', CHAIR_DIMS, f.position.x, f.position.z + off))
      }
    }
    // 床：床头两侧补床头柜（初始在床两侧，摆放流程会随床贴墙落在床头墙边）
    if (kind === 'bed' && !has('nightstand')) {
      const dx = f.dimensions.length / 2 + NIGHTSTAND_DIMS.width / 2 + 0.05
      push(makeFurniture('床头柜', NIGHTSTAND_DIMS, f.position.x - dx, f.position.z))
      push(makeFurniture('床头柜', NIGHTSTAND_DIMS, f.position.x + dx, f.position.z))
    }
    // 沙发：前方补茶几（背侧反方向）
    if (kind === 'sofa' && !has('table')) {
      push(makeFurniture('茶几', COFFEE_TABLE_DIMS, f.position.x, f.position.z - FRONT_GAP))
    }
  }
  return additions.length > 0 ? [...furniture, ...additions] : furniture
}
