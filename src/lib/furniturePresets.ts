/**
 * 家具视觉种类与部件拼装（纯函数，无渲染依赖）。
 *
 * 设计原则：家具不再渲染为统一长方体，而是按种类拼装成多个部件
 * （床=床架+床垫+床头板+枕头；衣柜=箱体+两扇门板；沙发=底座+靠背+座面+扶手…）。
 *
 * ## 朝向（Facing）
 * 家具现在有方向性部件（床头板/柜门/靠背等），渲染时需知道家具背侧贴哪面墙：
 * - `facingFromRoom(node, room, backAxis)`：背侧沿**长轴**（床，床头在长轴端、跨短边）
 *   或**短轴**（柜/沙发等，背侧沿进深）来决定，朝该轴方向上最近的墙；
 * - `buildFurnitureParts(kind, L, H, W, facing)`：柜/沙发等先按「背侧朝 +z」的规范朝向构建，
 *   再对**东/西墙**用「交换长宽后旋转 90°」、对**南/北墙**用 0°/180°，保持 L×W 足迹不变
 *   （`BACK_DIR` 声明每类背侧的局部方向）；床单独处理（床头板在长轴端）。
 *
 * ## 包围盒约束
 * 所有部件水平（x/z）必须钳制在 L×W 足迹内（墙碰撞/Gizmo 缩放按足迹算）；竖直方向底面必须贴地
 * （y ≥ -H/2），顶部允许向上悬挑（如电视柜上的电视屏高于柜体），因为上方无墙体、不影响碰撞。
 *
 * ## 共面（z-fighting）
 * 门板/床头板/靠背等前脸部件**不得与箱体/床架前脸共面**（都在 W/2 或 L/2 上会闪）。
 * 方案：箱体前脸后缩（`bodyRecess = doorTh + 0.02`）、门板凸出贴前脸；床头板内凹 0.05。
 */
import type { Dimensions, Position } from '../types/model'

/** 部件形状：box=长方体（size=[长,高,深]）；cylinder=绕 Y 轴的圆柱（size=[半径,高,半径]） */
export type PartShape = 'box' | 'cylinder'

/** 家具部件：相对家具中心（本地原点）的偏移与尺寸 */
export interface FurniturePart {
  /** 相对家具中心的偏移（米，y 相对家具中心高度） */
  center: [number, number, number]
  /** box：[长x, 高y, 深z]；cylinder：[半径, 高y, 半径]（米） */
  size: [number, number, number]
  shape?: PartShape
  /**
   * 配色：base=家具主色（FURNITURE_COLOR，色盲模式自动切换）；secondary=中性副色；
   * dark=深色强调（床头板/柜门/电视屏等，标准与色盲模式下均与浅色主色对比鲜明）
   */
  shade: 'base' | 'secondary' | 'dark'
}

/** 家具视觉种类；generic 为未识别，回退为单个整盒 */
export type FurnitureKind =
  | 'bed'
  | 'wardrobe'
  | 'desk'
  | 'sofa'
  | 'chair'
  | 'toilet'
  | 'sink'
  | 'fridge'
  | 'tvCabinet'
  | 'table'
  | 'roundTable'
  | 'bookcase'
  | 'washer'
  | 'bathtub'
  | 'nightstand'
  | 'dressingTable'
  | 'shoeCabinet'
  | 'stove'
  | 'oven'
  | 'microwave'
  | 'generic'

/** 家具背侧贴靠的墙（renderer 由家具位置与父房间包围盒算出） */
export type FacingDir = 'north' | 'south' | 'east' | 'west'

/** 夹具：v 钳制到 [min, max] */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 离地高度 h（0=地板）转为中心相对 y（地板 y=-H/2） */
function yFromFloor(h: number, H: number): number {
  return -H / 2 + h
}

/** 含这些词的家具先归为通用整盒，避免误套大件造型（如床尾凳含「床」会误套床造型） */
const GENERIC_GUARD_RE = /床尾凳|床幔/

/**
 * 分类词表，按顺序匹配（先易误判词/具体词，后宽松词）。
 * 词表为中文主词表——生成数据由大模型按中文提示词产出，英文名不参与分类（见交接文档坑 27）。
 * 顺序注意：床头柜/床边柜须在「床」之前（含「床」）；电视柜须在「电视」之前（含「电视」）。
 */
const KIND_RE: Array<[FurnitureKind, RegExp]> = [
  ['sofa', /沙发/],
  ['nightstand', /床头柜|床边柜|床头几/],
  ['dressingTable', /梳妆台|化妆台|妆台/],
  ['bed', /床/],
  ['roundTable', /圆桌|圆形茶几|圆几/],
  ['wardrobe', /衣柜|衣橱|衣帽间|壁柜|储物柜/],
  ['desk', /书桌|写字台|办公桌|电脑桌|学习桌/],
  ['tvCabinet', /电视柜/],
  ['bookcase', /书架|书柜/],
  ['table', /茶几|餐桌|饭桌|边几|咖啡桌/],
  ['chair', /椅|凳/],
  ['toilet', /马桶|座便器/],
  ['sink', /洗手池|洗手盆|洗脸盆|洗漱台|水槽/],
  ['bathtub', /浴缸|浴盆|泡澡桶/],
  ['shoeCabinet', /鞋柜|玄关柜|门厅柜|鞋橱/],
  ['stove', /灶台|燃气灶|炉灶|灶具/],
  ['oven', /烤箱/],
  ['microwave', /微波炉|微波/],
  ['fridge', /冰箱/],
  ['washer', /洗衣机/],
]

/** 家具名 → 视觉种类；未命中任意词表时回退 generic */
export function furnitureKind(name: string): FurnitureKind {
  if (GENERIC_GUARD_RE.test(name)) return 'generic'
  for (const [kind, re] of KIND_RE) {
    if (re.test(name)) return kind
  }
  return 'generic'
}

/**
 * 每类家具背侧的局部方向（规范朝向下背侧贴墙的那一侧，north=+z、east=+x…）。
 * - 柜/冰箱/洗衣机/书架/鞋柜/烤箱/微波炉/床头柜：门朝前（+z），背侧 -z（south）；
 * - 沙发/椅子/马桶/洗手池/梳妆台：靠背/水箱/盆/镜面朝墙（+z）；
 * - 灶台：操作台面朝使用者（-z），背侧 +z（north），同书桌；
 * - 床与浴缸不在此表（单独处理，背侧沿长轴）。
 */
const BACK_DIR: Record<Exclude<FurnitureKind, 'bed' | 'bathtub' | 'generic'>, FacingDir> = {
  wardrobe: 'south',
  desk: 'north',
  sofa: 'north',
  chair: 'north',
  toilet: 'north',
  sink: 'north',
  fridge: 'south',
  tvCabinet: 'south',
  table: 'north',
  roundTable: 'north',
  bookcase: 'south',
  washer: 'south',
  nightstand: 'south',
  dressingTable: 'north',
  shoeCabinet: 'south',
  stove: 'north',
  oven: 'south',
  microwave: 'south',
}

/**
 * 每类家具背侧沿哪条轴贴墙：
 * - long（床/浴缸）：床头在长轴端/浴缸长边贴墙，朝向由**长轴**方向上最近的墙决定；
 * - short（柜/沙发等）：背侧沿进深（短轴），朝向由**短轴**上最近的墙决定。
 */
export const BACK_AXIS: Record<FurnitureKind, 'long' | 'short'> = {
  bed: 'long',
  wardrobe: 'short',
  desk: 'short',
  sofa: 'short',
  chair: 'short',
  toilet: 'short',
  sink: 'short',
  fridge: 'short',
  tvCabinet: 'short',
  table: 'short',
  roundTable: 'short',
  bookcase: 'short',
  washer: 'short',
  bathtub: 'long',
  nightstand: 'short',
  dressingTable: 'short',
  shoeCabinet: 'short',
  stove: 'short',
  oven: 'short',
  microwave: 'short',
  generic: 'short',
}

/**
 * 使规范朝向的背侧局部方向朝 facing 墙所需的绕 Y 旋转角（度）。
 * 绕 Y 轴各角度下 +z 的去向：0→+z，90→-x，180→-z，270→+x。
 */
function angleFor(back: FacingDir, facing: FacingDir): number {
  const TABLE: Record<string, number> = {
    'north-north': 0,
    'north-south': 180,
    'north-east': 270,
    'north-west': 90,
    'south-north': 180,
    'south-south': 0,
    'south-east': 90,
    'south-west': 270,
    'east-north': 90,
    'east-south': 270,
    'east-east': 0,
    'east-west': 180,
    'west-north': 270,
    'west-south': 90,
    'west-east': 180,
    'west-west': 0,
  }
  return TABLE[`${back}-${facing}`]
}

/**
 * 绕 Y 轴旋转部件列表（中心旋转 + x/z 尺寸互换），保持整体足迹不变。
 * cylinder 绕 Y 轴旋转是恒等变换（其轴为 Y），无需特殊处理。
 */
function orientParts(parts: FurniturePart[], angleDeg: number): FurniturePart[] {
  if (angleDeg === 0) return parts
  return parts.map((p) => {
    const [cx, cy, cz] = p.center
    const [sx, sy, sz] = p.size
    switch (angleDeg) {
      case 90:
        return { ...p, center: [-cz, cy, cx], size: [sz, sy, sx] }
      case 180:
        return { ...p, center: [-cx, cy, -cz] }
      case 270:
        return { ...p, center: [cz, cy, -cx], size: [sz, sy, sx] }
      default:
        return p
    }
  })
}

/**
 * 家具背侧应贴靠的墙。
 * 规则：背侧沿长轴（床）→ 朝长轴方向上最近的墙；沿短轴（柜/沙发等）→ 朝短轴上最近的墙。
 * 不能直接用「最近墙」：贴墙家具长边沿墙，但若最近墙落在长轴方向（如转角衣柜被 tie 到
 * 相邻墙），柜门就会开到小面。
 */
export function facingFromRoom(
  f: { position: Position; dimensions: Dimensions },
  room: { position: Position; dimensions: Dimensions },
  backAxis: 'long' | 'short' = 'short',
): FacingDir {
  const L = f.dimensions.length
  const W = f.dimensions.width
  const longIsX = L >= W
  const dEast = room.position.x + room.dimensions.length / 2 - (f.position.x + L / 2)
  const dWest = f.position.x - L / 2 - (room.position.x - room.dimensions.length / 2)
  const dNorth = room.position.z + room.dimensions.width / 2 - (f.position.z + W / 2)
  const dSouth = f.position.z - W / 2 - (room.position.z - room.dimensions.width / 2)
  const nearest = (axis: 'x' | 'z'): FacingDir =>
    axis === 'x' ? (dEast < dWest ? 'east' : 'west') : dNorth < dSouth ? 'north' : 'south'
  const axis = backAxis === 'long' ? (longIsX ? 'x' : 'z') : longIsX ? 'z' : 'x'
  return nearest(axis)
}

// ---------------------------------------------------------------------------
// 规范朝向构建器（背侧朝 ±z，facing 由 buildFurnitureParts 统一处理；床单独处理）
// ---------------------------------------------------------------------------

/**
 * 床：床架（主色）+ 床垫 + 床头板 + 枕头。
 * 床头板与枕头在**长轴端**（跨短边 = 短边中间），朝向由 facing 决定（长轴 + 方向）。
 * 枕头嵌入床垫 2cm、顶部凸出，避免与床垫顶面共面（z-fighting 闪烁）。
 */
function buildBedParts(L: number, H: number, W: number, facing: FacingDir): FurniturePart[] {
  const frameH = clamp(H * 0.45, 0.06, 0.3)
  const mattressH = clamp(H * 0.38, 0.05, 0.24)
  const frameY = yFromFloor(frameH / 2, H)
  const mattressY = yFromFloor(frameH + mattressH / 2, H)
  // 床头板：深色、高度近整盒、内凹 2cm 避与床架前脸共面
  const headboardH = Math.min(H, clamp(H * 0.95, 0.25, 0.7))
  const headboardY = yFromFloor(headboardH / 2, H)
  const pillowTh = clamp(mattressH * 0.5, 0.05, 0.1)
  const pillowY = yFromFloor(frameH + mattressH - 0.02 + pillowTh / 2, H)

  const longIsX = L >= W
  const long = Math.max(L, W)
  const short = Math.min(L, W)
  // 长轴 + 端朝向 facing；facing 为 - 方向时镜像到 - 端
  const headAlongX = longIsX ? (facing === 'east' ? 1 : -1) : 0
  const headAlongZ = longIsX ? 0 : facing === 'north' ? 1 : -1
  const inset = 0.05
  const headX = headAlongX !== 0 ? headAlongX * (long / 2 - inset) : 0
  const headZ = headAlongZ !== 0 ? headAlongZ * (long / 2 - inset) : 0
  const headboardSize: [number, number, number] = longIsX
    ? [0.06, headboardH, short * 0.98]
    : [short * 0.98, headboardH, 0.06]

  // 枕头：长轴端、短轴中间，长边沿短轴
  const pillowInset = clamp(long * 0.2, 0.12, 0.3)
  const pillowAlongLong = clamp(long * 0.28, 0.2, 0.5) // 沿长轴（薄）
  const pillowAlongShort = clamp(short * 0.45, 0.3, 0.7) // 沿短轴（宽）
  const px = headAlongX !== 0 ? headAlongX * (long / 2 - pillowInset) : 0
  const pz = headAlongZ !== 0 ? headAlongZ * (long / 2 - pillowInset) : 0
  const pillowSize: [number, number, number] = longIsX
    ? [pillowAlongLong, pillowTh, pillowAlongShort]
    : [pillowAlongShort, pillowTh, pillowAlongLong]

  return [
    { center: [0, frameY, 0], size: [L, frameH, W], shade: 'base' },
    { center: [0, mattressY, 0], size: [L * 0.96, mattressH, W * 0.96], shade: 'secondary' },
    { center: [headX, headboardY, headZ], size: headboardSize, shade: 'dark' },
    { center: [px, pillowY, pz], size: pillowSize, shade: 'dark' },
  ]
}

/** 衣柜：箱体（主色）+ 前脸两扇深色门板（+z，中缝加宽）+ 中缝侧把手 */
function wardrobeParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.97
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorH = H * 0.9
  const doorY = yFromFloor((H - doorH) / 2 + doorH / 2, H)
  const doorW = Math.max(0.06, L / 2 - 0.07) // 中缝 0.14，更明显
  const doorTh = clamp(W * 0.12, 0.03, 0.06)
  // 箱体前脸后缩、门板凸出贴前脸，避免门面与箱面共面（z-fighting 闪烁）
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [-L / 4, doorY, doorZ], size: [doorW, doorH, doorTh], shade: 'dark' },
    { center: [L / 4, doorY, doorZ], size: [doorW, doorH, doorTh], shade: 'dark' },
  ]
}

/** 书桌：桌面（主色）+ 四条桌腿（副色），桌腿略微内收 */
function deskParts(L: number, H: number, W: number): FurniturePart[] {
  const topTh = clamp(H * 0.1, 0.03, 0.06)
  const topY = yFromFloor(H - topTh / 2, H)
  const legTh = clamp(Math.min(L, W) * 0.06, 0.03, 0.06)
  const legH = H - topTh
  const legY = yFromFloor(legH / 2, H)
  const legX = L / 2 - legTh / 2 - 0.02
  const legZ = W / 2 - legTh / 2 - 0.02
  return [
    { center: [0, topY, 0], size: [L, topTh, W], shade: 'base' },
    { center: [legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
  ]
}

/** 沙发：底座 + 靠背（+z，贴墙）+ 座面（副色）+ 左右扶手 */
function sofaParts(L: number, H: number, W: number): FurniturePart[] {
  const backH = clamp(H * 0.6, 0.3, 0.55)
  const backTh = clamp(W * 0.1, 0.05, 0.09)
  const backY = yFromFloor(backH / 2, H)
  const seatTop = clamp(H * 0.5, 0.3, 0.45)
  const seatH = clamp(H * 0.16, 0.08, 0.14)
  const baseH = seatTop - seatH
  const baseY = yFromFloor(baseH / 2, H)
  const seatD = clamp(W * 0.55, 0.35, 0.5)
  const seatY = yFromFloor(seatTop - seatH / 2, H)
  const seatZ = W / 2 - backTh - seatD / 2
  const armTh = clamp(L * 0.06, 0.06, 0.12)
  const armH = clamp(H * 0.5, 0.25, 0.45)
  const armY = yFromFloor(armH / 2, H)
  return [
    { center: [0, baseY, 0], size: [L, baseH, W], shade: 'base' },
    // 靠背/扶手内凹 3cm，避免与底座前脸/侧面共面（z-fighting）
    { center: [0, backY, W / 2 - 0.03 - backTh / 2], size: [L, backH, backTh], shade: 'base' },
    { center: [0, seatY, seatZ], size: [L * 0.94, seatH, seatD], shade: 'secondary' },
    { center: [L / 2 - 0.03 - armTh / 2, armY, 0], size: [armTh, armH, W * 0.9], shade: 'base' },
    { center: [-L / 2 + 0.03 + armTh / 2, armY, 0], size: [armTh, armH, W * 0.9], shade: 'base' },
  ]
}

/** 椅子：座面（副色）+ 靠背（+z）+ 四条腿 */
function chairParts(L: number, H: number, W: number): FurniturePart[] {
  const seatTop = clamp(H * 0.55, 0.35, 0.48)
  const seatH = clamp(H * 0.1, 0.04, 0.08)
  const seatY = yFromFloor(seatTop - seatH / 2, H)
  const backH = clamp(H * 0.4, 0.18, 0.35)
  const backTh = clamp(W * 0.1, 0.04, 0.06)
  const backY = yFromFloor(seatTop + backH / 2, H)
  const legTh = clamp(Math.min(L, W) * 0.08, 0.03, 0.05)
  const legH = seatTop - seatH
  const legY = yFromFloor(legH / 2, H)
  const legX = L / 2 - legTh / 2 - 0.01
  const legZ = W / 2 - legTh / 2 - 0.01
  return [
    { center: [0, seatY, 0], size: [L * 0.92, seatH, W * 0.92], shade: 'secondary' },
    { center: [0, backY, W / 2 - backTh / 2], size: [L * 0.9, backH, backTh], shade: 'base' },
    { center: [legX, legY, legZ], size: [legTh, legH, legTh], shade: 'base' },
    { center: [-legX, legY, legZ], size: [legTh, legH, legTh], shade: 'base' },
    { center: [legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'base' },
    { center: [-legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'base' },
  ]
}

/** 马桶：水箱（+z，贴墙）+ 底座 + 座圈（深色） */
function toiletParts(L: number, H: number, W: number): FurniturePart[] {
  const tankH = clamp(H * 0.5, 0.3, 0.45)
  const tankTh = clamp(W * 0.16, 0.1, 0.16)
  const tankY = yFromFloor(tankH / 2, H)
  const baseH = clamp(H * 0.45, 0.28, 0.4)
  const baseY = yFromFloor(baseH / 2, H)
  const baseD = clamp(W * 0.55, 0.32, 0.45)
  const baseZ = -W * 0.08
  const seatTh = clamp(H * 0.05, 0.03, 0.05)
  const seatY = yFromFloor(baseH + seatTh / 2, H)
  const seatD = clamp(W * 0.35, 0.22, 0.3)
  return [
    { center: [0, tankY, W / 2 - tankTh / 2], size: [L * 0.75, tankH, tankTh], shade: 'secondary' },
    { center: [0, baseY, baseZ], size: [L * 0.7, baseH, baseD], shade: 'secondary' },
    { center: [0, seatY, baseZ], size: [L * 0.55, seatTh, seatD], shade: 'dark' },
  ]
}

/** 洗手池：柜体（主色）+ 台面（副色）+ 台上深色盆 */
function sinkParts(L: number, H: number, W: number): FurniturePart[] {
  const depth = clamp(W * 0.8, 0.35, 0.5)
  const cabH = clamp(H * 0.5, 0.3, 0.55)
  const cabY = yFromFloor(cabH / 2, H)
  const topTh = clamp(H * 0.06, 0.03, 0.05)
  const topY = yFromFloor(cabH + topTh / 2, H)
  const basinR = clamp(Math.min(L, W) * 0.22, 0.1, 0.16)
  const basinY = yFromFloor(cabH + topTh + 0.02, H)
  const basinZ = W * 0.12
  return [
    { center: [0, cabY, 0], size: [L, cabH, depth], shade: 'base' },
    { center: [0, topY, 0], size: [L, topTh, depth], shade: 'secondary' },
    { center: [basinZ * 0.4, basinY, basinZ], size: [basinR, 0.05, basinR], shape: 'cylinder', shade: 'dark' },
  ]
}

/** 冰箱：箱体（主色）+ 冷冻/冷藏两扇深色门（+z） */
function fridgeParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.98
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorTh = clamp(W * 0.1, 0.04, 0.07)
  // 箱体前脸后缩、门板凸出贴前脸，避免门面与箱面共面（z-fighting 闪烁）
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  const topDoorH = clamp(H * 0.3, 0.25, 0.5)
  const topDoorY = yFromFloor(H - topDoorH / 2, H)
  const gap = clamp(H * 0.02, 0.01, 0.03)
  const bottomDoorH = H - topDoorH - gap
  const bottomDoorY = yFromFloor(gap + bottomDoorH / 2, H)
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [0, topDoorY, doorZ], size: [L * 0.94, topDoorH, doorTh], shade: 'dark' },
    { center: [0, bottomDoorY, doorZ], size: [L * 0.94, bottomDoorH, doorTh], shade: 'dark' },
  ]
}

/** 电视柜：矮柜（主色）+ 上置电视屏（深色，允许高于盒顶） */
function tvCabinetParts(L: number, H: number, W: number): FurniturePart[] {
  const cabH = H * 0.92
  const cabY = yFromFloor(cabH / 2, H)
  // 屏幕宽钳制 ≤ L（东/西朝向交换长宽后 L 可能很小，防越足迹）
  const screenW = Math.min(clamp(L * 0.7, 0.5, 1.2), L)
  const screenH = clamp(H * 1.4, 0.5, 0.65)
  const screenY = yFromFloor(cabH + screenH / 2, H)
  const footH = clamp(H * 0.15, 0.04, 0.08)
  const footY = yFromFloor(cabH + footH / 2, H)
  return [
    { center: [0, cabY, 0], size: [L, cabH, W], shade: 'base' },
    { center: [0, screenY, 0], size: [screenW, screenH, 0.04], shade: 'dark' },
    { center: [0, footY, 0], size: [screenW * 0.5, footH, W * 0.4], shade: 'secondary' },
  ]
}

/** 矩形餐桌/茶几：桌面（主色）+ 四条桌腿（副色） */
function tableParts(L: number, H: number, W: number): FurniturePart[] {
  const topTh = clamp(H * 0.08, 0.03, 0.05)
  const topY = yFromFloor(H - topTh / 2, H)
  const legTh = clamp(Math.min(L, W) * 0.06, 0.03, 0.05)
  const legH = H - topTh
  const legY = yFromFloor(legH / 2, H)
  const legX = L / 2 - legTh / 2 - 0.02
  const legZ = W / 2 - legTh / 2 - 0.02
  return [
    { center: [0, topY, 0], size: [L, topTh, W], shade: 'base' },
    { center: [legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
  ]
}

/** 圆桌：圆柱桌面（主色）+ 中柱 + 底座 */
function roundTableParts(L: number, H: number, W: number): FurniturePart[] {
  const r = Math.min(L, W) / 2
  const topTh = clamp(H * 0.08, 0.03, 0.06)
  const topY = yFromFloor(H - topTh / 2, H)
  const legR = clamp(r * 0.12, 0.03, 0.06)
  const legH = H - topTh
  const legY = yFromFloor(legH / 2, H)
  const baseR = clamp(r * 0.35, 0.1, 0.2)
  const baseH = clamp(H * 0.06, 0.03, 0.05)
  const baseY = yFromFloor(baseH / 2, H)
  return [
    { center: [0, topY, 0], size: [r, topTh, r], shape: 'cylinder', shade: 'base' },
    { center: [0, legY, 0], size: [legR, legH, legR], shape: 'cylinder', shade: 'secondary' },
    { center: [0, baseY, 0], size: [baseR, baseH, baseR], shape: 'cylinder', shade: 'secondary' },
  ]
}

/** 书架：左右侧板 + 背板（-z，贴墙）+ 三块搁板，前开向房间 */
function bookcaseParts(L: number, H: number, W: number): FurniturePart[] {
  const shellH = H * 0.97
  const shellY = yFromFloor(shellH / 2, H)
  const sideTh = clamp(W * 0.14, 0.03, 0.05)
  const backTh = clamp(W * 0.14, 0.03, 0.05)
  const shelfTh = 0.025
  const shelfDepth = W - backTh - 0.01
  const shelfW = L - sideTh * 2
  const shelves: FurniturePart[] = [0.25, 0.5, 0.75].map((f) => ({
    center: [0, yFromFloor(H * f, H), 0],
    size: [shelfW, shelfTh, shelfDepth],
    shade: 'secondary',
  }))
  return [
    { center: [-L / 2 + sideTh / 2, shellY, 0], size: [sideTh, shellH, W], shade: 'base' },
    { center: [L / 2 - sideTh / 2, shellY, 0], size: [sideTh, shellH, W], shade: 'base' },
    { center: [0, shellY, -W / 2 + backTh / 2], size: [L, shellH, backTh], shade: 'base' },
    ...shelves,
  ]
}

/** 洗衣机：箱体（主色）+ 前门深色门板（+z）+ 顶部控制面板 */
function washerParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.98
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorD = clamp(Math.min(L, W) * 0.45, 0.3, 0.42)
  const doorY = yFromFloor(clamp(H * 0.4, 0.25, 0.42), H)
  const doorTh = clamp(W * 0.08, 0.03, 0.05)
  // 箱体前脸后缩、门/面板凸出贴前脸，避免共面 z-fighting
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  const panelW = clamp(L * 0.7, 0.3, 0.5)
  const panelH = clamp(H * 0.12, 0.06, 0.1)
  const panelY = yFromFloor(clamp(H * 0.92, 0.8, 0.88), H)
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [0, doorY, doorZ], size: [doorD, doorD, doorTh], shade: 'dark' },
    { center: [0, panelY, doorZ], size: [panelW, panelH, doorTh], shade: 'secondary' },
  ]
}

/** 浴缸：缸体外壳（主色）+ 内胆（深色，顶部内嵌）+ 端头水龙头（副色）。背侧沿长轴贴墙（同床处理）。 */
function buildBathtubParts(L: number, H: number, W: number, facing: FacingDir): FurniturePart[] {
  const tubH = clamp(H * 0.55, 0.35, 0.6)
  const tubY = yFromFloor(tubH / 2, H)
  const innerH = clamp(H * 0.14, 0.05, 0.12)
  const innerY = yFromFloor(tubH - innerH / 2, H)
  const longIsX = L >= W
  const long = Math.max(L, W)
  const short = Math.min(L, W)
  const innerSize: [number, number, number] = longIsX
    ? [long - 0.12, innerH, short - 0.18]
    : [short - 0.18, innerH, long - 0.12]
  // 水龙头在长轴端（背侧端头，同床头方向），跨短边居中
  const faucetAlongX = longIsX ? (facing === 'east' ? 1 : -1) : 0
  const faucetAlongZ = longIsX ? 0 : facing === 'north' ? 1 : -1
  const inset = 0.06
  const faucetX = faucetAlongX !== 0 ? faucetAlongX * (long / 2 - inset) : 0
  const faucetZ = faucetAlongZ !== 0 ? faucetAlongZ * (long / 2 - inset) : 0
  const faucetH = clamp(H * 0.8, 0.3, 0.6)
  const faucetY = yFromFloor(faucetH / 2, H)
  const faucetSize: [number, number, number] = longIsX
    ? [0.06, faucetH, short * 0.35]
    : [short * 0.35, faucetH, 0.06]
  return [
    { center: [0, tubY, 0], size: [L, tubH, W], shade: 'base' },
    { center: [0, innerY, 0], size: innerSize, shade: 'dark' },
    { center: [faucetX, faucetY, faucetZ], size: faucetSize, shade: 'secondary' },
  ]
}

/** 床头柜：柜体（主色，前脸后缩）+ 抽屉面（深色，凸出贴前脸）+ 顶板（副色） */
function nightstandParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.92
  const bodyY = yFromFloor(bodyH / 2, H)
  const drawerTh = clamp(W * 0.12, 0.02, 0.04)
  const bodyRecess = drawerTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const drawerH = clamp(H * 0.34, 0.08, 0.18)
  const drawerY = yFromFloor(H * 0.42, H)
  const drawerZ = W / 2 - drawerTh / 2
  const topTh = clamp(H * 0.08, 0.02, 0.04)
  const topY = yFromFloor(H - topTh / 2, H)
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [0, drawerY, drawerZ], size: [L * 0.9, drawerH, drawerTh], shade: 'dark' },
    { center: [0, topY, 0], size: [L, topTh, W], shade: 'secondary' },
  ]
}

/** 梳妆台：桌面（主色）+ 四条桌腿（副色）+ 镜面（深色，贴后墙、顶部允许向上悬挑） */
function dressingTableParts(L: number, H: number, W: number): FurniturePart[] {
  const topTh = clamp(H * 0.08, 0.03, 0.05)
  const topY = yFromFloor(H - topTh / 2, H)
  const legTh = clamp(Math.min(L, W) * 0.07, 0.03, 0.05)
  const legH = H - topTh
  const legY = yFromFloor(legH / 2, H)
  const legX = L / 2 - legTh / 2 - 0.02
  const legZ = W / 2 - legTh / 2 - 0.02
  const mirrorH = clamp(H * 1.1, 0.4, 0.7)
  const mirrorY = yFromFloor(H - topTh + mirrorH / 2, H)
  const mirrorTh = clamp(W * 0.06, 0.02, 0.04)
  const mirrorZ = W / 2 - mirrorTh / 2
  const mirrorW = Math.min(clamp(L * 0.8, 0.4, 0.9), L)
  return [
    { center: [0, topY, 0], size: [L, topTh, W], shade: 'base' },
    { center: [legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [-legX, legY, -legZ], size: [legTh, legH, legTh], shade: 'secondary' },
    { center: [0, mirrorY, mirrorZ], size: [mirrorW, mirrorH, mirrorTh], shade: 'dark' },
  ]
}

/** 鞋柜：柜体（主色，前脸后缩）+ 上下两扇门（深色，中缝明显） */
function shoeCabinetParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.97
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorTh = clamp(W * 0.12, 0.03, 0.06)
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  const gap = clamp(H * 0.03, 0.01, 0.04)
  const topDoorH = clamp(H * 0.45, 0.18, 0.35)
  const topDoorY = yFromFloor(H - gap - topDoorH / 2, H)
  const bottomDoorH = H - topDoorH - gap
  const bottomDoorY = yFromFloor(bottomDoorH / 2, H)
  const doorW = L * 0.9
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [0, topDoorY, doorZ], size: [doorW, topDoorH, doorTh], shade: 'dark' },
    { center: [0, bottomDoorY, doorZ], size: [doorW, bottomDoorH, doorTh], shade: 'dark' },
  ]
}

/** 灶台：柜体（主色）+ 台面（副色）+ 四个炉头（深色圆柱）+ 前缘控制条（深色，贴前脸） */
function stoveParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.85
  const bodyY = yFromFloor(bodyH / 2, H)
  const topTh = clamp(H * 0.07, 0.03, 0.05)
  const topY = yFromFloor(H - topTh / 2, H)
  const burnerR = clamp(Math.min(L, W) * 0.12, 0.04, 0.08)
  const burnerY = yFromFloor(H - topTh - 0.005, H)
  const qx = L / 4
  const qz = W / 4
  const burners: FurniturePart[] = (
    [
      [qx, qz],
      [-qx, qz],
      [qx, -qz],
      [-qx, -qz],
    ] as const
  ).map(([bx, bz]) => ({
    center: [bx, burnerY, bz],
    size: [burnerR, 0.02, burnerR],
    shape: 'cylinder',
    shade: 'dark',
  }))
  const ctrlH = clamp(H * 0.12, 0.04, 0.08)
  const ctrlY = yFromFloor(bodyH - ctrlH / 2, H)
  const ctrlTh = clamp(W * 0.08, 0.03, 0.05)
  const ctrlZ = -W / 2 + ctrlTh / 2
  const ctrlW = Math.min(clamp(L * 0.7, 0.3, 0.8), L)
  return [
    { center: [0, bodyY, 0], size: [L, bodyH, W], shade: 'base' },
    { center: [0, topY, 0], size: [L, topTh, W], shade: 'secondary' },
    ...burners,
    { center: [0, ctrlY, ctrlZ], size: [ctrlW, ctrlH, ctrlTh], shade: 'dark' },
  ]
}

/** 烤箱：柜体（主色，前脸后缩）+ 深色玻璃门（凸出贴前脸）+ 内嵌把手条（副色） */
function ovenParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.98
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorTh = clamp(W * 0.1, 0.04, 0.07)
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  const doorH = clamp(H * 0.8, 0.3, 0.55)
  const doorY = yFromFloor((H - doorH) / 2 + doorH / 2, H)
  // 把手条内嵌于门面（不凸出前脸，避免越足迹），深色门上浅色横条示意
  const handleTh = clamp(W * 0.04, 0.01, 0.02)
  const handleH = clamp(H * 0.03, 0.01, 0.02)
  const handleY = yFromFloor(H - handleH / 2 - clamp(H * 0.05, 0.02, 0.06), H)
  const handleZ = doorZ - doorTh / 2 + handleTh / 2
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [0, doorY, doorZ], size: [L * 0.86, doorH, doorTh], shade: 'dark' },
    { center: [0, handleY, handleZ], size: [L * 0.5, handleH, handleTh], shade: 'secondary' },
  ]
}

/** 微波炉：柜体（主色，前脸后缩）+ 深色门（凸出贴前脸）+ 右侧控制面板（副色） */
function microwaveParts(L: number, H: number, W: number): FurniturePart[] {
  const bodyH = H * 0.98
  const bodyY = yFromFloor(bodyH / 2, H)
  const doorTh = clamp(W * 0.12, 0.04, 0.08)
  const bodyRecess = doorTh + 0.02
  const bodyZ = W - bodyRecess
  const bodyCenterZ = -bodyRecess / 2
  const doorZ = W / 2 - doorTh / 2
  const doorH = clamp(H * 0.7, 0.2, 0.3)
  const doorY = yFromFloor((H - doorH) / 2 + doorH / 2, H)
  const doorW = Math.min(clamp(L * 0.7, 0.25, 0.45), L - 0.05)
  const gap = 0.05
  const panelW = Math.max(0, L - doorW - gap)
  // 门左缘与柜体左缘对齐（x 最左侧），面板居右侧，总宽 = L
  const doorCenterX = -L / 2 + doorW / 2
  const panelCenterX = doorCenterX + doorW / 2 + gap + panelW / 2
  const panelH = clamp(H * 0.5, 0.12, 0.2)
  const panelY = yFromFloor(H * 0.55, H)
  return [
    { center: [0, bodyY, bodyCenterZ], size: [L, bodyH, bodyZ], shade: 'base' },
    { center: [doorCenterX, doorY, doorZ], size: [doorW, doorH, doorTh], shade: 'dark' },
    { center: [panelCenterX, panelY, doorZ], size: [panelW, panelH, doorTh], shade: 'secondary' },
  ]
}

const BUILDERS: Record<Exclude<FurnitureKind, 'bed' | 'bathtub' | 'generic'>, (L: number, H: number, W: number) => FurniturePart[]> = {
  wardrobe: wardrobeParts,
  desk: deskParts,
  sofa: sofaParts,
  chair: chairParts,
  toilet: toiletParts,
  sink: sinkParts,
  fridge: fridgeParts,
  tvCabinet: tvCabinetParts,
  table: tableParts,
  roundTable: roundTableParts,
  bookcase: bookcaseParts,
  washer: washerParts,
  nightstand: nightstandParts,
  dressingTable: dressingTableParts,
  shoeCabinet: shoeCabinetParts,
  stove: stoveParts,
  oven: ovenParts,
  microwave: microwaveParts,
}

/**
 * 生成家具部件列表（含朝向）。
 * - 水平（x/z）钳制在 L×W 足迹内，底面贴地；顶部允许向上悬挑（如电视屏）。
 * - 床单独处理（床头板在长轴端）；柜/沙发等按「交换长宽 + 旋转」保持足迹与朝向同时正确。
 * - generic 回退为单个整盒（与旧渲染一致）。
 */
export function buildFurnitureParts(
  kind: FurnitureKind,
  L: number,
  H: number,
  W: number,
  facing: FacingDir = 'north',
): FurniturePart[] {
  if (kind === 'bed') return buildBedParts(L, H, W, facing)
  if (kind === 'bathtub') return buildBathtubParts(L, H, W, facing)
  if (kind === 'generic') {
    return [{ center: [0, 0, 0], size: [L, H, W], shade: 'base' }]
  }
  const swap = facing === 'east' || facing === 'west'
  const [BL, BW] = swap ? [W, L] : [L, W]
  const parts = BUILDERS[kind](BL, H, BW)
  const angle = angleFor(BACK_DIR[kind], facing)
  return orientParts(parts, angle)
}

/** 部件并集包围盒（相对家具中心），用于选中/高亮轮廓 */
export function partsBounds(parts: FurniturePart[]): {
  min: [number, number, number]
  max: [number, number, number]
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    for (let i = 0; i < 3; i++) {
      const lo = p.center[i] - p.size[i] / 2
      const hi = p.center[i] + p.size[i] / 2
      if (lo < min[i]) min[i] = lo
      if (hi > max[i]) max[i] = hi
    }
  }
  return { min, max }
}
