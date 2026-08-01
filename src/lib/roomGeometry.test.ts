import { describe, expect, it } from 'vitest'
import type { ContainerNode } from '../types/model'
import { computeDoorWalls, doorDirection } from './roomGeometry'

function room(
  id: string,
  name: string,
  x: number,
  z: number,
  len: number,
  wid: number,
  h = 2.8,
): ContainerNode {
  return {
    id,
    type: 'room',
    name,
    dimensions: { length: len, width: wid, height: h },
    position: { x, y: h / 2, z },
    children: [],
  }
}

describe('doorDirection（兜底门朝向）', () => {
  it('房间在整屋左侧时门朝东（指向中心）', () => {
    expect(doorDirection({ position: { x: -2, y: 1.4, z: 0 } })).toBe('east')
  })

  it('房间在整屋右侧时门朝西', () => {
    expect(doorDirection({ position: { x: 2, y: 1.4, z: 0 } })).toBe('west')
  })

  it('房间位于中心时默认朝北', () => {
    expect(doorDirection({ position: { x: 0, y: 1.4, z: 0 } })).toBe('north')
  })
})

describe('computeDoorWalls（相邻房间开门）', () => {
  it('东西相邻：在共用墙（东/西墙）开门', () => {
    const a = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const map = computeDoorWalls([a, corridor])
    expect(map.get('master')).toContain('east')
    expect(map.get('corridor')).toContain('west')
  })

  it('南北相邻：在南北墙开门', () => {
    const a = room('living', '客厅', 0, -1.5, 3, 3)
    const b = room('bedroom', '主卧', 0, 1.5, 3, 3)
    const map = computeDoorWalls([a, b])
    expect(map.get('living')).toContain('north')
    expect(map.get('bedroom')).toContain('south')
  })

  it('相距较远的房间不开门', () => {
    const a = room('a', '客厅', -5, 0, 3, 3)
    const b = room('b', '主卧', 5, 0, 3, 3)
    const map = computeDoorWalls([a, b])
    expect(map.get('a')).toHaveLength(0)
    expect(map.get('b')).toHaveLength(0)
  })

  it('走廊两侧房间各开一扇朝向走廊的门', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const living = room('living', '客厅', 2, 0, 3, 3)
    const map = computeDoorWalls([master, corridor, living])
    expect(map.get('master')).toEqual(['east'])
    expect(map.get('corridor')).toEqual(expect.arrayContaining(['west', 'east']))
    expect(map.get('living')).toEqual(['west'])
  })
})
