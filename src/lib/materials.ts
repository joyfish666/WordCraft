/**
 * 程序化材质层（纯函数 + 全局纹理缓存，无渲染依赖）。
 *
 * 设计原则（见「房屋造型材质设计」）：
 * - 零外部资源：所有贴图用 Canvas 程序化生成（正弦/值噪声均为周期函数，
 *   贴图平铺天然无缝，wrap = RepeatWrapping 即可）；
 * - 纹理为中性灰调，与 tint 色相乘 —— 房间识别色保留在地板（乘算后仍可辨），
 *   墙身中性化；色盲模式靠明度 + 图案区分，不依赖色相；
 * - 全部函数确定性与 seed 无关（固定 seed），缓存按 kind 全局共享（约 6 张 256²）。
 *
 * ## UV 约定
 * - 地板：ExtrudeGeometry 顶面 UV 取形状世界坐标（未归一化），
 *   共享纹理 repeat = 1/tileMeters 即按世界米平铺（板缝对齐）；
 * - 墙/屋顶/地面：Box/Plane 几何 UV 归一化，用 scaleUvs / boxWallGeometry
 *   按段长（米）拉伸 UV，同样共用共享纹理实例，无需 clone。
 */
import * as THREE from 'three'
import { darkenHex, mixHex, roomFaceColor, softenTint, WALL_EXTERIOR_COLOR } from './palette'
import type { FurnitureKind, FurniturePart } from './furniturePresets'
import type { ColorMode } from '../types/settings'

/** 纹理种类（每类一张共享 Canvas 贴图） */
export type TextureKind =
  | 'woodFloor'
  | 'tileFloor'
  | 'concreteFloor'
  | 'woodGrain'
  | 'fabric'
  | 'grassGround'
  | 'plasterWall'

/** 地板纹理类别：由房间名分类决定 */
export type FloorTextureKind = 'wood' | 'tile' | 'concrete' | 'deck'

const SIZE = 256

/** 确定性伪随机（mulberry32），保证纹理生成稳定可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 周期性值噪声：网格坐标取模 wrap，任意画布位置平铺无缝 */
function makeNoise(seed: number, cellPx: number): (x: number, y: number) => number {
  const cells = Math.max(1, Math.floor(SIZE / cellPx))
  const cell = SIZE / cells
  const hash = (ix: number, iy: number): number => {
    const wx = ((ix % cells) + cells) % cells
    const wy = ((iy % cells) + cells) % cells
    const h =
      Math.imul(wx + 1, 374761393) + Math.imul(wy + 1, 668265263) + Math.imul(seed, 1442695041)
    const hh = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((hh ^ (hh >>> 16)) >>> 0) / 4294967296
  }
  return (x, y) => {
    const gx = x / cell
    const gy = y / cell
    const ix = Math.floor(gx)
    const iy = Math.floor(gy)
    const fx = gx - ix
    const fy = gy - iy
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const v00 = hash(ix, iy)
    const v10 = hash(ix + 1, iy)
    const v01 = hash(ix, iy + 1)
    const v11 = hash(ix + 1, iy + 1)
    return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v11 - v01 - v10 + v00) * sx * sy
  }
}

/** 每个像素后处理：明度乘 v（中性灰调，与 tint 相乘） */
function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}

// ---------------------------------------------------------------------------
// 纹理生成器（全部周期平铺；中心色为中性灰调，供 tint 乘算）
// ---------------------------------------------------------------------------

/**
 * 木地板：竖板顺纹（条纹沿板长方向拉长）、每块板独立明暗（板间色差）、
 * 板边压暗（倒角感）+ 少量深色树脂条纹。关键在「纹路有方向」——
 * 逐像素随机噪点是雪花感、不像木纹；真实木纹是沿板长的长条纹。
 * 底色刻意偏亮（约 0.73 灰）、对比拉高：乘 tint 后仍保持木纹可见，
 * 避免「灰蒙蒙」的廉价感（老版本底色 0.62，乘 tint 后整体过暗）。
 */
function drawWoodFloor(ctx: CanvasRenderingContext2D, rand: () => number, plankW = 32): void {
  const grain = makeNoise(7, 10)
  const mottle = makeNoise(5, 42)
  const streak = makeNoise(11, 14)
  const plankCount = SIZE / plankW
  // 每块板独立的基础明暗（板间色差是实木地板最重要的质感来源）
  const tones: number[] = []
  for (let p = 0; p < plankCount; p++) {
    tones.push(188 + (rand() - 0.5) * 46)
  }
  for (let x = 0; x < SIZE; x++) {
    const p = Math.min(plankCount - 1, Math.floor(x / plankW))
    const localX = x - p * plankW
    // 板缝：边界 1px 深缝
    if (localX === 0 || localX === plankW - 1) {
      ctx.fillStyle = rgb(92, 84, 70)
      ctx.fillRect(x, 0, 1, SIZE)
      continue
    }
    // 板边压暗、板中略亮的凸弧倒角感
    const edgeFade = Math.sin((localX / plankW) * Math.PI)
    for (let y = 0; y < SIZE; y++) {
      // 顺纹：x 高频（条纹窄）、y 低频（条纹沿板长拉长）
      const g = (grain(x * 4, y * 0.35) - 0.5) * 38
      const m = (mottle(x * 1.3, y * 0.5) - 0.5) * 24
      const darkStreak = streak(x * 3, y * 0.4) > 0.82 ? -28 : 0
      const v = Math.min(252, tones[p] + g + m + darkStreak - (1 - edgeFade) * 8)
      ctx.fillStyle = rgb(v, v * 0.95, v * 0.77)
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** 瓷砖：8×8 格 / 贴图，宽缝 + 每格深浅微差 */
function drawTileFloor(ctx: CanvasRenderingContext2D): void {
  const cell = SIZE / 8
  const noise = makeNoise(11, 48)
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const inGap = x % cell < 3 || y % cell < 3
      if (inGap) {
        ctx.fillStyle = 'rgb(178,174,160)'
      } else {
        const gx = Math.floor(x / cell)
        const gy = Math.floor(y / cell)
        const wob = (((gx * 13 + gy * 7) % 5) - 2) * 5 + (noise(x, y) - 0.5) * 8
        ctx.fillStyle = rgb(196 + wob, 198 + wob, 196 + wob)
      }
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** 混凝土：低频噪声 + 细颗粒斑点 */
function drawConcrete(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const noise = makeNoise(13, 20)
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const v = 186 + (noise(x, y) - 0.5) * 26
      ctx.fillStyle = rgb(v, v * 0.97, v * 0.92)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  for (let i = 0; i < 600; i++) {
    const x = Math.floor(rand() * SIZE)
    const y = Math.floor(rand() * SIZE)
    const v = rand() < 0.5 ? 20 : -14
    ctx.fillStyle = rgb(186 + v, 180 + v, 172 + v)
    ctx.fillRect(x, y, 1, 1)
  }
}

/** 外墙抹灰：细颗粒 + 低频抹痕（trowel 起伏），中性灰调供 tint 乘算 */
function drawPlaster(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const fine = makeNoise(31, 6)
  const trowel = makeNoise(37, 26)
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const v = 190 + (fine(x, y) - 0.5) * 14 + (trowel(x * 1.4, y * 1.1) - 0.5) * 10
      ctx.fillStyle = rgb(v, v, v)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  // 细砂粒斑点
  for (let i = 0; i < 1400; i++) {
    const x = Math.floor(rand() * SIZE)
    const y = Math.floor(rand() * SIZE)
    const d = rand() < 0.5 ? 9 : -7
    ctx.fillStyle = rgb(190 + d, 190 + d, 190 + d)
    ctx.fillRect(x, y, 1, 1)
  }
}

/** 家具细木纹：高频顺纹噪声 + 少数深色条纹 */
function drawWoodGrain(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const noise = makeNoise(17, 12)
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const streak = rand() < 0.012 ? -26 : 0
      const v = 176 + (noise(x * 2, y * 8) - 0.5) * 40 + streak
      ctx.fillStyle = rgb(v, v * 0.95, v * 0.82)
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** 织物：2px 平纹编织（明暗方块交替），低对比 */
function drawFabric(ctx: CanvasRenderingContext2D): void {
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const on = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0
      const v = on ? 186 : 168
      ctx.fillStyle = rgb(v, v * 0.97, v * 0.93)
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

/** 草地（室外地面）：中性灰调（绿色由 tint 乘算）+ 低频起伏 + 中频碎叶噪声 + 草丛斑块 + 草叶短划 */
function drawGrass(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const low = makeNoise(23, 40)
  const mid = makeNoise(29, 10)
  const BASE = 182
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const v = BASE + (low(x, y) - 0.5) * 20 + (mid(x, y) - 0.5) * 22
      ctx.fillStyle = rgb(v, v, v)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  // 草丛斑块：半透明加深，跨边回绕保持平铺无缝
  ctx.globalAlpha = 0.45
  for (let i = 0; i < 16; i++) {
    const cx = Math.floor(rand() * SIZE)
    const cy = Math.floor(rand() * SIZE)
    const r = 6 + Math.floor(rand() * 10)
    const d = -10 - Math.floor(rand() * 10)
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > r * r) continue
        const px = ((x % SIZE) + SIZE) % SIZE
        const py = ((y % SIZE) + SIZE) % SIZE
        ctx.fillStyle = rgb(BASE + d, BASE + d, BASE + d)
        ctx.fillRect(px, py, 1, 1)
      }
    }
  }
  ctx.globalAlpha = 1
  // 草叶短划：1×2 亮/暗竖划，模拟叶片受光与阴影
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rand() * SIZE)
    const y = Math.floor(rand() * SIZE)
    const d = rand() < 0.5 ? 20 : -14
    ctx.fillStyle = rgb(BASE + d, BASE + d, BASE + d)
    ctx.fillRect(x, y, 1, 1 + Math.floor(rand() * 2))
  }
}

const DRAWERS: Record<TextureKind, (ctx: CanvasRenderingContext2D, rand: () => number) => void> = {
  woodFloor: (ctx, rand) => drawWoodFloor(ctx, rand),
  tileFloor: (ctx) => drawTileFloor(ctx),
  concreteFloor: drawConcrete,
  woodGrain: drawWoodGrain,
  fabric: (ctx) => drawFabric(ctx),
  grassGround: drawGrass,
  plasterWall: drawPlaster,
}

/** 每类贴图的平铺周期（世界米/张；地板顶面 UV 为世界坐标） */
export const TEXTURE_TILE_METERS: Record<TextureKind, number> = {
  woodFloor: 1.2,
  tileFloor: 1.6,
  concreteFloor: 2.5,
  woodGrain: 1,
  fabric: 1,
  grassGround: 2,
  plasterWall: 2.5,
}

const textureCache = new Map<TextureKind, THREE.Texture>()
/** 世界米 UV（地板顶面）专用克隆：与 base 共享图像数据，仅 repeat 不同 */
const worldUvCache = new Map<TextureKind, THREE.Texture>()

/**
 * 获取（并缓存）指定种类的共享基础纹理；无 2D 上下文时返回空白纹理（测试环境降级）。
 * base 纹理 repeat = 1：归一化 UV 的几何（墙/屋顶/地面/家具）在几何层按米拉伸 UV，
 * 不在此处叠加 repeat（叠加会造成 tile² 双重缩放）。
 */
export function getTexture(kind: TextureKind): THREE.Texture {
  let tex = textureCache.get(kind)
  if (tex) return tex
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (ctx) DRAWERS[kind](ctx, mulberry32(kind.length * 7919 + 17))
  tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = kind === 'fabric' ? 4 : 8
  textureCache.set(kind, tex)
  return tex
}

/**
 * 世界米 UV 平铺纹理（地板 ExtrudeGeometry 顶面 UV 为世界坐标）：
 * base 的 clone（共享图像），repeat = 1/tileMeters 即按世界米对齐板缝。
 */
export function getWorldUvTexture(kind: TextureKind): THREE.Texture {
  let tex = worldUvCache.get(kind)
  if (tex) return tex
  tex = getTexture(kind).clone()
  const repeat = 1 / TEXTURE_TILE_METERS[kind]
  tex.repeat.set(repeat, repeat)
  tex.needsUpdate = true
  worldUvCache.set(kind, tex)
  return tex
}

// ---------------------------------------------------------------------------
// UV 工具：归一化 UV 按世界米拉伸，共享纹理免 clone
// ---------------------------------------------------------------------------

/** 缩放 BoxGeometry 指定顶点区间的 UV（u 沿局部 x、v 沿局部 y） */
function scaleFaceUvs(
  geometry: THREE.BufferGeometry,
  verts: number[],
  sx: number,
  sy: number,
): THREE.BufferGeometry {
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (const i of verts) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy)
  }
  uv.needsUpdate = true
  return geometry
}

/** 拉伸 BoxGeometry 所有面的 UV（v 方向按 y，近似用于平顶/女儿墙大盒） */
export function scaleAllUvs(
  geometry: THREE.BufferGeometry,
  sx: number,
  sy: number,
): THREE.BufferGeometry {
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy)
  }
  uv.needsUpdate = true
  return geometry
}

/**
 * 墙段盒几何：+z/-z 两个墙面（±z 面 = 第 16..23 个 UV 顶点）按
 * u = 段长/tile、v = 墙高/tile 拉伸，砖缝/纹路随段长连续。
 */
export function boxWallGeometry(
  len: number,
  height: number,
  thickness: number,
  tileMeters: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, height, thickness)
  return scaleFaceUvs(g, [16, 17, 18, 19, 20, 21, 22, 23], len / tileMeters, height / tileMeters)
}

/** 平面几何 UV 按世界尺寸拉伸（用于室外地面） */
export function planeGeometryWithUvs(
  width: number,
  depth: number,
  tileMeters: number,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, depth)
  return scaleAllUvs(g, width / tileMeters, depth / tileMeters)
}

// ---------------------------------------------------------------------------
// 材质分类（纯函数，可单测）
// ---------------------------------------------------------------------------

export interface MaterialSpec {
  /** 贴图种类（undefined = 纯色） */
  map?: TextureKind
  /** tint 色（与贴图相乘；无贴图时即纯色） */
  color: string
  roughness: number
  metalness: number
  /**
   * UV 约定：'world' = 顶面 UV 为世界米坐标（地板 Extrude），用带 repeat 的克隆纹理；
   * 'normalized'（默认）= UV 归一化、几何层已按米拉伸（墙/屋顶/地面/家具），用 base 纹理。
   */
  uvMode?: 'world' | 'normalized'
}

/** 把材质规格解析为可直传 meshStandardMaterial 的参数（map 种类 → 共享纹理实例） */
export function materialParams(spec: MaterialSpec): THREE.MeshStandardMaterialParameters {
  return {
    map: spec.map
      ? spec.uvMode === 'world'
        ? getWorldUvTexture(spec.map)
        : getTexture(spec.map)
      : undefined,
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
  }
}

export interface FloorMaterialSpec extends MaterialSpec {
  /** 地板类别（决定贴图与平铺周期） */
  kind: FloorTextureKind
}

/** 房间名 → 地板类别：卫生间/厨房=瓷砖、阳台=防腐木、其余（含走廊）=木地板。
 *  走廊用木地板而非混凝土：混凝土的灰绿色在暖色木地板房间群中格格不入，
 *  走廊与相邻房间同材质才能融入整体。 */
export function roomFloorKind(name: string): FloorTextureKind {
  if (/卫生间|浴室|厕所|洗漱/.test(name)) return 'tile'
  if (/厨房/.test(name)) return 'tile'
  if (/阳台|露台|阳光房/.test(name)) return 'deck'
  return 'wood'
}

const FLOOR_KIND_TO_TEXTURE: Record<FloorTextureKind, TextureKind> = {
  wood: 'woodFloor',
  tile: 'tileFloor',
  concrete: 'concreteFloor',
  deck: 'woodFloor',
}

/**
 * 地板 tint 策略：识别色只做「极淡的暖色调洗」——
 * 木地板/防腐木向暖白抹灰（#f0ede4）混 80%，蓝/绿等识别色乘出的脏灰感消失、
 * 木纹仍清晰；瓷砖/混凝土向纯白混 66%（格纹图案扛得住 tint，保持原观感）。
 * 色盲模式统一掺白 68%，靠明度/图案区分、不依赖色相。
 */
export function roomFloorMaterial(
  name: string,
  colorMode: ColorMode,
  siblingIndex: number,
): FloorMaterialSpec {
  const kind = roomFloorKind(name)
  const face = roomFaceColor(name, siblingIndex, colorMode)
  const color =
    colorMode === 'colorblind'
      ? softenTint(face, 0.68)
      : kind === 'wood' || kind === 'deck'
        ? mixHex(face, '#f0ede4', 0.8)
        : softenTint(face, 0.66)
  return {
    kind,
    map: FLOOR_KIND_TO_TEXTURE[kind],
    color,
    roughness: kind === 'wood' || kind === 'deck' ? 0.6 : 0.85,
    metalness: 0,
    uvMode: 'world',
  }
}

/** 内墙 / 外墙材质（外墙可加混凝土纹理，内墙纯色抹灰） */
export function interiorWallMaterial(): MaterialSpec {
  return { color: '#f0ede4', roughness: 0.92, metalness: 0 }
}

export function exteriorWallMaterial(): MaterialSpec {
  return { map: 'plasterWall', color: WALL_EXTERIOR_COLOR, roughness: 0.9, metalness: 0 }
}

/** 踢脚线材质（房间色加深，保留色相） */
export function skirtingMaterial(roomColor: string): MaterialSpec {
  return { color: darkenHex(roomColor, 0.55), roughness: 0.8, metalness: 0 }
}

// ---------------------------------------------------------------------------
// 家具材质表：按 (种类, 部件明度档) 匹配 木纹/织物/金属/陶瓷/玻璃/塑料
// ---------------------------------------------------------------------------

interface PartSpec {
  map?: TextureKind
  color: string
  roughness: number
  metalness: number
}

const WOOD_LIGHT: PartSpec = { map: 'woodGrain', color: '#ffffff', roughness: 0.6, metalness: 0 }
const WOOD_MED: PartSpec = { map: 'woodGrain', color: '#c9bfa8', roughness: 0.6, metalness: 0 }
const WOOD_DARK: PartSpec = { map: 'woodGrain', color: '#8a7c66', roughness: 0.55, metalness: 0 }
const FABRIC_LIGHT: PartSpec = { map: 'fabric', color: '#f0eadd', roughness: 0.95, metalness: 0 }
const FABRIC_MED: PartSpec = { map: 'fabric', color: '#d9d2c2', roughness: 0.95, metalness: 0 }
const FABRIC_DARK: PartSpec = { map: 'fabric', color: '#b9b09e', roughness: 0.95, metalness: 0 }
const METAL_LIGHT: PartSpec = { color: '#d8dbde', roughness: 0.35, metalness: 0.75 }
const METAL_DARK: PartSpec = { color: '#9aa0a6', roughness: 0.4, metalness: 0.75 }
const CERAMIC_WHITE: PartSpec = { color: '#f2f0ea', roughness: 0.2, metalness: 0.05 }
const CERAMIC_DARK: PartSpec = { color: '#c6c2ba', roughness: 0.3, metalness: 0.05 }
const GLASS_DARK: PartSpec = { color: '#17191d', roughness: 0.15, metalness: 0.3 }
const PLASTIC_WHITE: PartSpec = { color: '#eceae2', roughness: 0.5, metalness: 0 }
const PLASTIC_MED: PartSpec = { color: '#c9cdd2', roughness: 0.5, metalness: 0 }

/** 色盲模式：统一替换为中性灰，靠明度/图案区分 */
const GRAY: Record<'base' | 'secondary' | 'dark', PartSpec> = {
  base: { map: 'woodGrain', color: '#f0f0f0', roughness: 0.7, metalness: 0 },
  secondary: { map: 'woodGrain', color: '#b8b8b8', roughness: 0.7, metalness: 0 },
  dark: { map: 'woodGrain', color: '#707070', roughness: 0.7, metalness: 0 },
}

const FURNITURE_PARTS: Record<FurnitureKind, Record<'base' | 'secondary' | 'dark', PartSpec>> = {
  bed: { base: WOOD_LIGHT, secondary: FABRIC_MED, dark: FABRIC_LIGHT },
  wardrobe: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: WOOD_DARK },
  desk: { base: WOOD_LIGHT, secondary: METAL_LIGHT, dark: METAL_DARK },
  sofa: { base: FABRIC_MED, secondary: FABRIC_DARK, dark: FABRIC_LIGHT },
  chair: { base: WOOD_LIGHT, secondary: FABRIC_MED, dark: WOOD_DARK },
  toilet: { base: CERAMIC_WHITE, secondary: CERAMIC_WHITE, dark: CERAMIC_DARK },
  sink: { base: WOOD_LIGHT, secondary: METAL_LIGHT, dark: CERAMIC_WHITE },
  fridge: { base: METAL_LIGHT, secondary: METAL_LIGHT, dark: METAL_DARK },
  tvCabinet: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: GLASS_DARK },
  table: { base: WOOD_LIGHT, secondary: METAL_LIGHT, dark: METAL_DARK },
  roundTable: { base: WOOD_LIGHT, secondary: METAL_LIGHT, dark: METAL_DARK },
  bookcase: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: WOOD_DARK },
  washer: { base: METAL_LIGHT, secondary: PLASTIC_MED, dark: GLASS_DARK },
  bathtub: { base: CERAMIC_WHITE, secondary: METAL_LIGHT, dark: CERAMIC_DARK },
  nightstand: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: WOOD_DARK },
  dressingTable: { base: WOOD_LIGHT, secondary: METAL_LIGHT, dark: GLASS_DARK },
  shoeCabinet: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: WOOD_DARK },
  stove: { base: PLASTIC_WHITE, secondary: METAL_LIGHT, dark: METAL_DARK },
  oven: { base: METAL_LIGHT, secondary: METAL_LIGHT, dark: GLASS_DARK },
  microwave: { base: PLASTIC_WHITE, secondary: PLASTIC_MED, dark: GLASS_DARK },
  generic: { base: WOOD_LIGHT, secondary: WOOD_MED, dark: WOOD_DARK },
}

/** 家具部件材质：按 (种类, 明度档) 匹配；色盲模式统一中性灰 */
export function furnitureMaterial(
  kind: FurnitureKind,
  shade: FurniturePart['shade'],
  colorMode: ColorMode,
): MaterialSpec {
  const spec =
    (colorMode === 'colorblind' ? GRAY : (FURNITURE_PARTS[kind] ?? FURNITURE_PARTS.generic))[
      shade
    ] ?? WOOD_LIGHT
  return { map: spec.map, color: spec.color, roughness: spec.roughness, metalness: spec.metalness }
}
