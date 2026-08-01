import type { SceneModel } from '../types/model'

/**
 * 示例模型：一条走廊连接主卧与客厅的小户型。
 * 用于在接入大模型前验证 3D 渲染管线（Phase 0）。
 */
export function createSampleModel(): SceneModel {
  return {
    version: 1,
    root: {
      id: 'house-sample',
      type: 'house',
      name: '示例小屋',
      dimensions: { length: 7, width: 4, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      children: [
        {
          id: 'corridor',
          type: 'room',
          name: '走廊',
          dimensions: { length: 1, width: 4, height: 2.8 },
          position: { x: 0, y: 1.4, z: 0 },
          children: [],
        },
        {
          id: 'room-master',
          type: 'room',
          name: '主卧',
          dimensions: { length: 3, width: 3, height: 2.8 },
          position: { x: -2, y: 1.4, z: 0 },
          children: [
            {
              id: 'bed-master',
              type: 'furniture',
              name: '双人床',
              dimensions: { length: 2, width: 1.5, height: 0.5 },
              position: { x: -2, y: 0.25, z: 0 },
              description: '2m × 1.5m 双人床',
            },
            {
              id: 'wardrobe-master',
              type: 'furniture',
              name: '衣柜',
              dimensions: { length: 1.2, width: 0.6, height: 2.4 },
              position: { x: -2.6, y: 1.2, z: -0.9 },
              description: '1.2m × 0.6m × 2.4m 双开门衣柜',
            },
          ],
        },
        {
          id: 'room-living',
          type: 'room',
          name: '客厅',
          dimensions: { length: 3, width: 3, height: 2.8 },
          position: { x: 2, y: 1.4, z: 0 },
          children: [
            {
              id: 'sofa-living',
              type: 'furniture',
              name: '沙发',
              dimensions: { length: 2, width: 0.9, height: 0.8 },
              position: { x: 2, y: 0.4, z: 0.5 },
              description: '2m 三人位沙发',
            },
            {
              id: 'table-living',
              type: 'furniture',
              name: '茶几',
              dimensions: { length: 1.1, width: 0.6, height: 0.45 },
              position: { x: 2, y: 0.225, z: -0.6 },
              description: '1.1m × 0.6m 茶几',
            },
          ],
        },
      ],
    },
  }
}
