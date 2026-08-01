import { describe, expect, it } from 'vitest'
import { compressObject, decompressObject, decodeShareCode, encodeShareCode } from './compression'

describe('compression（口令压缩）', () => {
  it('JSON 通过口令往返还原', () => {
    const payload = { name: '主卧', size: 3, nested: { list: [1, 2, 3] } }
    const code = encodeShareCode(JSON.stringify(payload))
    expect(decodeShareCode(code)).toBe(JSON.stringify(payload))
  })

  it('对象通过 compressObject / decompressObject 往返还原', () => {
    const data = { rooms: [{ name: '客厅', size: 12 }] }
    const restored = decompressObject<typeof data>(compressObject(data))
    expect(restored).toEqual(data)
  })

  it('真实规模的模型数据压缩后应显著短于原始 JSON', () => {
    // 模拟一个含多个房间与家具的层级模型
    const model = {
      version: 1,
      root: {
        id: 'house',
        type: 'house',
        name: '示例小屋',
        dimensions: { length: 6, width: 4, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        children: [
          {
            id: 'room-1',
            type: 'room',
            name: '主卧',
            dimensions: { length: 3, width: 3, height: 2.8 },
            position: { x: -1.5, y: 1.4, z: 0.5 },
            children: [
              { id: 'bed', type: 'furniture', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 }, position: { x: -1.5, y: 0.25, z: 0.5 } },
              { id: 'wardrobe', type: 'furniture', name: '衣柜', dimensions: { length: 1.2, width: 0.6, height: 2.4 }, position: { x: 0, y: 1.2, z: -0.6 } },
            ],
          },
          {
            id: 'room-2',
            type: 'room',
            name: '客厅',
            dimensions: { length: 3, width: 3, height: 2.8 },
            position: { x: 1.5, y: 1.4, z: 0.5 },
            children: [
              { id: 'sofa', type: 'furniture', name: '沙发', dimensions: { length: 2, width: 0.9, height: 0.8 }, position: { x: 1.5, y: 0.4, z: 0.5 } },
            ],
          },
        ],
      },
    }
    const payload = JSON.stringify(model)
    expect(encodeShareCode(payload).length).toBeLessThan(payload.length)
  })

  it('非法口令返回 null', () => {
    expect(decompressObject('@@@not-a-valid-code@@@')).toBeNull()
    expect(decompressObject('')).toBeNull()
  })
})
