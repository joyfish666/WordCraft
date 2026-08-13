import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleModel } from '../lib/sampleModel'
import { toChatHistory, useChatStore } from './useChatStore'

const modelA = createSampleModel()
const modelB = JSON.parse(JSON.stringify(modelA)) as typeof modelA
modelB.root.name = '修改后的小屋'

beforeEach(() => {
  localStorage.clear()
  useChatStore.setState({ messages: [], isGenerating: false, generationStack: [], editOps: [] })
})

describe('useChatStore 生成历史（撤销生成）', () => {
  it('pushGenerationHistory 记录生成前场景；undoLastGeneration 弹出快照并移除最后 user+assistant 对', () => {
    useChatStore.getState().addMessage({ role: 'user', content: '改一下' })
    useChatStore.getState().addMessage({ role: 'assistant', content: 'ok', model: modelB })
    useChatStore.getState().pushGenerationHistory(modelA)

    const restored = useChatStore.getState().undoLastGeneration()
    expect(restored).toBe(modelA)
    expect(useChatStore.getState().messages).toHaveLength(0)
    expect(useChatStore.getState().generationStack).toHaveLength(0)
  })

  it('栈为空时 undoLastGeneration 返回 null 且不动消息', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
    expect(useChatStore.getState().undoLastGeneration()).toBeNull()
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('最后一条不是携带模型的助手消息时不撤销', () => {
    useChatStore.getState().pushGenerationHistory(modelA)
    useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
    expect(useChatStore.getState().undoLastGeneration()).toBeNull()
    expect(useChatStore.getState().generationStack).toHaveLength(1)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('生成历史栈上限 20', () => {
    for (let i = 0; i < 25; i++) useChatStore.getState().pushGenerationHistory(modelA)
    expect(useChatStore.getState().generationStack).toHaveLength(20)
  })

  it('clearConversation 同时清空生成历史', () => {
    useChatStore.getState().pushGenerationHistory(modelA)
    useChatStore.getState().clearConversation()
    expect(useChatStore.getState().generationStack).toHaveLength(0)
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})

describe('useChatStore 编辑操作日志（P3 双向同步）', () => {
  it('pushEditOps 追加手动编辑操作', () => {
    const ops = [
      {
        op: 'updateFurniture',
        roomId: 'r',
        id: 'f',
        patch: { position: { x: 1, y: 0.5, z: 0 } },
      } as const,
    ]
    useChatStore.getState().pushEditOps(ops)
    useChatStore.getState().pushEditOps([{ op: 'setHouse', name: 'x' }])
    expect(useChatStore.getState().editOps).toHaveLength(2)
    expect(useChatStore.getState().editOps[0]).toEqual(ops[0])
  })

  it('编辑操作日志上限 50', () => {
    for (let i = 0; i < 55; i++) {
      useChatStore.getState().pushEditOps([{ op: 'setHouse', name: `n${i}` }])
    }
    expect(useChatStore.getState().editOps).toHaveLength(50)
    // 保留的是最近 50 条
    expect(useChatStore.getState().editOps[0]).toEqual({ op: 'setHouse', name: 'n5' })
    expect(useChatStore.getState().editOps[49]).toEqual({ op: 'setHouse', name: 'n54' })
  })

  it('clearEditOps 清空日志；clearConversation 一并清空', () => {
    useChatStore.getState().pushEditOps([{ op: 'setHouse', name: 'x' }])
    useChatStore.getState().clearEditOps()
    expect(useChatStore.getState().editOps).toHaveLength(0)
    useChatStore.getState().pushEditOps([{ op: 'setHouse', name: 'y' }])
    useChatStore.getState().clearConversation()
    expect(useChatStore.getState().editOps).toHaveLength(0)
  })

  it('editOps 不持久化（partialize 只存 messages）', () => {
    useChatStore.getState().pushEditOps([{ op: 'setHouse', name: 'x' }])
    const persisted = JSON.parse(localStorage.getItem('wordcraft.chat') ?? '{}')
    expect(persisted.state.editOps).toBeUndefined()
  })
})

describe('toChatHistory（P3 上下文精简：整段 ops JSON 不再回传）', () => {
  const opsReply = '{"version":3,"ops":[{"op":"macro","name":"corridor","params":{"rooms":[]}}]}'

  it('保留用户消息；助手纯 JSON 消息被剔除', () => {
    useChatStore.getState().addMessage({ role: 'user', content: '设计一个房子' })
    useChatStore.getState().addMessage({ role: 'assistant', content: opsReply, model: modelA })
    useChatStore.getState().addMessage({ role: 'user', content: '客厅再大一点' })
    const history = toChatHistory(useChatStore.getState().messages)
    expect(history).toEqual([
      { role: 'user', content: '设计一个房子' },
      { role: 'user', content: '客厅再大一点' },
    ])
  })

  it('带文本的助手消息（非纯 JSON）保留', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: '好的，客厅已加大' })
    const history = toChatHistory(useChatStore.getState().messages)
    expect(history).toEqual([{ role: 'assistant', content: '好的，客厅已加大' }])
  })

  it('跳过错误消息与空内容', () => {
    useChatStore.getState().addMessage({ role: 'error', content: '请求失败' })
    useChatStore.getState().addMessage({ role: 'user', content: '  ' })
    useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
    expect(toChatHistory(useChatStore.getState().messages)).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })
})
