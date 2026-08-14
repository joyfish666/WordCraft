import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  boxWallGeometry,
  exteriorWallMaterial,
  furnitureMaterial,
  getTexture,
  getWorldUvTexture,
  planeGeometryWithUvs,
  roomFloorKind,
  roomFloorMaterial,
  skirtingMaterial,
  TEXTURE_TILE_METERS,
} from './materials'

describe('materials（程序化材质层）', () => {
  describe('roomFloorKind 房间类型 → 地板类别', () => {
    it('卫生间/厨房 → 瓷砖，走廊 → 木地板（融入暖色房间群），阳台 → 防腐木，其余 → 木地板', () => {
      expect(roomFloorKind('主卧卫生间')).toBe('tile')
      expect(roomFloorKind('卫生间')).toBe('tile')
      expect(roomFloorKind('厨房')).toBe('tile')
      expect(roomFloorKind('走廊')).toBe('wood')
      expect(roomFloorKind('阳台')).toBe('deck')
      expect(roomFloorKind('卧室')).toBe('wood')
      expect(roomFloorKind('客厅')).toBe('wood')
      // 未识别（英文名/自造词）回退木地板
      expect(roomFloorKind('Living Room')).toBe('wood')
    })
  })

  describe('roomFloorMaterial', () => {
    it('tint 为房间识别色淡化（非纯色）', () => {
      const m = roomFloorMaterial('卧室', 'standard', 0)
      expect(m.kind).toBe('wood')
      expect(m.map).toBe('woodFloor')
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(m.color).not.toBe('#ffffff')
      expect(m.roughness).toBeGreaterThan(0)
    })

    it('地板为世界米 UV（顶面 UV 即世界坐标，用带 repeat 的克隆纹理）', () => {
      expect(roomFloorMaterial('客厅', 'standard', 0).uvMode).toBe('world')
    })

    it('色盲模式 tint 与标准模式不同（明度/图案区分，不依赖色相）', () => {
      const standard = roomFloorMaterial('卧室', 'standard', 0)
      const colorblind = roomFloorMaterial('卧室', 'colorblind', 0)
      expect(colorblind.color).not.toBe(standard.color)
    })

    it('同一房间两种模式贴图一致（纹理种类不随模式变）', () => {
      expect(roomFloorMaterial('厨房', 'standard', 1).map).toBe(
        roomFloorMaterial('厨房', 'colorblind', 1).map,
      )
    })
  })

  describe('furnitureMaterial', () => {
    it('床：床架木纹、床垫织物', () => {
      expect(furnitureMaterial('bed', 'base', 'standard').map).toBe('woodGrain')
      expect(furnitureMaterial('bed', 'secondary', 'standard').map).toBe('fabric')
    })

    it('马桶 → 陶瓷（无贴图、低粗糙度）', () => {
      const m = furnitureMaterial('toilet', 'base', 'standard')
      expect(m.map).toBeUndefined()
      expect(m.roughness).toBeLessThan(0.5)
    })

    it('电视柜 → 电视屏为深色玻璃', () => {
      const m = furnitureMaterial('tvCabinet', 'dark', 'standard')
      expect(m.map).toBeUndefined()
      expect(m.metalness).toBeGreaterThan(0)
    })

    it('色盲模式统一中性灰、保留明度差异', () => {
      const base = furnitureMaterial('bed', 'base', 'colorblind')
      const dark = furnitureMaterial('bed', 'dark', 'colorblind')
      expect(base.color).toBe('#f0f0f0')
      expect(dark.color).toBe('#707070')
    })
  })

  describe('墙体材质', () => {
    it('内墙纯色抹灰、外墙抹灰纹理', () => {
      expect(exteriorWallMaterial().map).toBe('plasterWall')
    })

    it('踢脚线为房间色加深', () => {
      const m = skirtingMaterial('#4f7cff')
      expect(m.color).toBe('#2b448c')
    })
  })

  describe('getTexture 缓存与平铺', () => {
    it('同类贴图全局单例', () => {
      expect(getTexture('woodFloor')).toBe(getTexture('woodFloor'))
      expect(getTexture('woodFloor')).not.toBe(getTexture('fabric'))
    })

    it('base 纹理 repeat = 1（归一化 UV 几何自行按米拉伸，不叠加 repeat 避免 tile² 双重缩放）', () => {
      for (const kind of Object.keys(TEXTURE_TILE_METERS) as (keyof typeof TEXTURE_TILE_METERS)[]) {
        const tex = getTexture(kind)
        expect(tex.wrapS).toBe(THREE.RepeatWrapping)
        expect(tex.repeat.x).toBe(1)
      }
    })

    it('getWorldUvTexture：base 克隆、共享图像、repeat 按世界米倒置（地板顶面 UV 为世界坐标）', () => {
      for (const kind of Object.keys(TEXTURE_TILE_METERS) as (keyof typeof TEXTURE_TILE_METERS)[]) {
        const base = getTexture(kind)
        const tex = getWorldUvTexture(kind)
        expect(tex).not.toBe(base)
        expect(tex.repeat.x).toBeCloseTo(1 / TEXTURE_TILE_METERS[kind], 5)
        expect(tex.source).toBe(base.source)
        expect(getWorldUvTexture(kind)).toBe(tex)
      }
    })
  })

  describe('UV 拉伸工具', () => {
    it('boxWallGeometry：±z 面 UV 按段长/墙高拉伸', () => {
      const g = boxWallGeometry(3, 2.6, 0.15, 1.2)
      const uv = g.attributes.uv as THREE.BufferAttribute
      // 面内最大 u（沿段长）与最大 v（沿墙高）应为 段长/tile 与 墙高/tile
      for (const face of [
        [16, 17, 18, 19],
        [20, 21, 22, 23],
      ]) {
        const maxX = Math.max(...face.map((i) => uv.getX(i)))
        const maxY = Math.max(...face.map((i) => uv.getY(i)))
        expect(maxX).toBeCloseTo(3 / 1.2, 5)
        expect(maxY).toBeCloseTo(2.6 / 1.2, 5)
      }
      // 其余四面（端面/顶底）不参与拉伸
      const other = [0, 4, 8, 12]
      expect(Math.max(...other.map((i) => uv.getX(i)))).toBeLessThanOrEqual(1.0001)
    })

    it('planeGeometryWithUvs 按世界尺寸拉伸', () => {
      const g = planeGeometryWithUvs(10, 8, 2)
      const uv = g.attributes.uv as THREE.BufferAttribute
      const maxX = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))
      const maxY = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))
      expect(maxX).toBeCloseTo(5, 5) // (10/2)
      expect(maxY).toBeCloseTo(4, 5) // (8/2)
    })
  })
})
