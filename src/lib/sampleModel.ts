import { resolveLayout } from './layout'
import type { FurnitureNodeV2, RoomNodeV2, SceneModel } from '../types/model'

/** 构造 v2 家具（position 相对所在房间中心，y 为高度一半，底面贴地） */
function f(
  id: string,
  name: string,
  length: number,
  width: number,
  x: number,
  z: number,
  height = 0.5,
): FurnitureNodeV2 {
  return {
    id,
    type: 'furniture',
    name,
    dimensions: { length, width, height },
    position: { x, y: height / 2, z },
  }
}

/**
 * 示例模型：一条东西向走廊连接南侧（客厅/餐厅/公共卫生间）与北侧（厨房/主卧/次卧），
 * 主卧带内嵌卫生间。走布局引擎（resolveLayout）生成，与真实生成流程一致——
 * 房间沿走廊两侧均衡排列、家具按常理摆放、内嵌卫生间靠父房间角落、入户门在南侧。
 */
export function createSampleModel(): SceneModel {
  return resolveLayout({
    version: 2,
    root: {
      id: 'house-sample',
      type: 'house',
      name: '示例小屋',
      dimensions: { length: 14, width: 10, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'room-living' } },
      children: [
        {
          id: 'room-living',
          type: 'room',
          name: '客厅',
          side: 'left',
          dimensions: { length: 6, width: 4.5, height: 2.8 },
          children: [
            f('sofa-living', '沙发', 2.2, 0.9, -1.5, -1.2, 0.8),
            f('coffee-living', '茶几', 1.2, 0.6, -1.5, 0.3, 0.45),
            f('tv-living', '电视柜', 1.8, 0.4, -1.5, 1.8, 0.5),
          ],
        },
        {
          id: 'room-kitchen',
          type: 'room',
          name: '厨房',
          side: 'right',
          dimensions: { length: 3.5, width: 3, height: 2.8 },
          children: [
            f('fridge-kitchen', '冰箱', 0.7, 0.7, -1.2, -0.8, 1.8),
            f('cabinet-kitchen', '橱柜', 2.5, 0.6, 0.2, -1.2, 0.85),
            f('stove-kitchen', '灶台', 0.8, 0.6, 0.2, 1.2, 0.8),
          ],
        },
        {
          id: 'room-dining',
          type: 'room',
          name: '餐厅',
          side: 'left',
          dimensions: { length: 3.5, width: 3, height: 2.8 },
          children: [
            f('dtable-dining', '餐桌', 1.6, 0.9, 0, 0, 0.75),
            f('chair1-dining', '餐椅', 0.45, 0.45, -0.8, 0, 0.9),
            f('chair2-dining', '餐椅', 0.45, 0.45, 0.8, 0, 0.9),
          ],
        },
        {
          id: 'room-master',
          type: 'room',
          name: '主卧',
          side: 'right',
          dimensions: { length: 4.5, width: 4, height: 2.8 },
          children: [
            f('bed-master', '双人床', 2, 1.5, -1, -1),
            f('wardrobe-master', '衣柜', 1.2, 0.6, 1.2, -1.2, 2),
            f('nightstand-master', '床头柜', 0.5, 0.4, -1.8, -1, 0.5),
            {
              id: 'bath-master',
              type: 'room',
              name: '主卧卫生间',
              side: 'north',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
              children: [
                f('toilet-master', '马桶', 0.6, 0.4, -0.5, -0.4, 0.7),
                f('sink-master', '洗手池', 0.6, 0.5, 0.5, -0.4, 0.8),
              ],
            },
          ],
        },
        {
          id: 'room-bed2',
          type: 'room',
          name: '次卧',
          side: 'right',
          dimensions: { length: 3.5, width: 3.5, height: 2.8 },
          children: [
            f('bed-bed2', '单人床', 2, 1.2, -0.8, -0.8),
            f('wardrobe-bed2', '衣柜', 1.2, 0.6, 1, -1, 2),
          ],
        },
        {
          id: 'room-publicbath',
          type: 'room',
          name: '公共卫生间',
          side: 'left',
          dimensions: { length: 2.5, width: 2, height: 2.8 },
          children: [
            f('toilet-public', '马桶', 0.6, 0.4, -0.6, -0.5, 0.7),
            f('sink-public', '洗手池', 0.6, 0.5, 0.6, -0.5, 0.8),
          ],
        },
      ] as RoomNodeV2[],
    },
  })
}
