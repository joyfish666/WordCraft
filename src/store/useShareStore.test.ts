import { beforeEach, describe, expect, it } from 'vitest'
import { useShareStore } from './useShareStore'

beforeEach(() => {
  localStorage.clear()
  useShareStore.setState({ records: [] })
})

describe('useShareStore（分享口令历史）', () => {
  it('addRecord 置顶添加记录并写入 localStorage', () => {
    useShareStore.getState().addRecord({ name: '示例小屋', code: 'abc123' })
    useShareStore.getState().addRecord({ code: 'def456' })
    const records = useShareStore.getState().records
    expect(records).toHaveLength(2)
    expect(records[0].code).toBe('def456') // 最新在前
    expect(records[0].name).toBeUndefined()
    expect(records[1].name).toBe('示例小屋')
    expect(records[1].code).toBe('abc123')
    // 持久化：只存 records
    const persisted = JSON.parse(localStorage.getItem('wordcraft.share')!)
    expect(persisted.state.records).toHaveLength(2)
  })

  it('历史上限 20 条，超出丢弃最旧', () => {
    for (let i = 0; i < 25; i++) {
      useShareStore.getState().addRecord({ code: `code-${i}` })
    }
    const records = useShareStore.getState().records
    expect(records).toHaveLength(20)
    expect(records[0].code).toBe('code-24') // 最新
    expect(records[19].code).toBe('code-5') // 最旧被丢弃（code-0..4 已移除）
  })

  it('removeRecord / clearRecords 删除与清空', () => {
    useShareStore.getState().addRecord({ code: 'a' })
    useShareStore.getState().addRecord({ code: 'b' })
    const [first, second] = useShareStore.getState().records
    useShareStore.getState().removeRecord(first.id)
    expect(useShareStore.getState().records.map((r) => r.code)).toEqual(['a'])
    useShareStore.getState().clearRecords()
    expect(useShareStore.getState().records).toHaveLength(0)
    expect(second).toBeTruthy()
  })
})
