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

  it('持久化消息不携带 model（多轮场景快照不再落盘，避免 5MB 配额与全量重序列化）', () => {
    useChatStore.getState().addMessage({ role: 'user', content: '设计一个房子' })
    useChatStore.getState().addMessage({ role: 'assistant', content: 'ok', model: modelA })
    const persisted = JSON.parse(localStorage.getItem('wordcraft.chat') ?? '{}')
    expect(persisted.version).toBe(3)
    expect(persisted.state.messages).toHaveLength(2)
    for (const m of persisted.state.messages) expect(m.model).toBeUndefined()
    // 内存中 model 仍保留（撤销生成依赖），持久化剥离不影响运行时
    expect(useChatStore.getState().messages[1]!.model).toBe(modelA)
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

  it('超长会话只送最近 30 条（旧轮次由场景摘要/编辑日志替代）', () => {
    for (let i = 0; i < 40; i++) {
      useChatStore.getState().addMessage({ role: 'user', content: `消息${i}` })
    }
    const history = toChatHistory(useChatStore.getState().messages)
    expect(history).toHaveLength(30)
    expect(history[0]).toEqual({ role: 'user', content: '消息10' })
    expect(history[29]).toEqual({ role: 'user', content: '消息39' })
  })

  it('messages 有上限：超 100 条丢弃最旧消息（防 5MB 配额逼近）', () => {
    for (let i = 0; i < 120; i++) {
      useChatStore.getState().addMessage({ role: 'user', content: `消息${i}` })
    }
    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(100)
    expect(messages[0]!.content).toBe('消息20')
    expect(messages[99]!.content).toBe('消息119')
  })
})

describe('useChatStore persist 迁移（rehydrate 端到端，v2 存档剥离 model）', () => {
  it('v2 存档（消息带 model 整场景快照）rehydrate 后消息无 model 字段', async () => {
    localStorage.setItem(
      'wordcraft.chat',
      JSON.stringify({
        state: {
          messages: [
            { id: 'm1', role: 'user', content: '设计一个房子', createdAt: 1 },
            { id: 'm2', role: 'assistant', content: '好的', model: modelA, createdAt: 2 },
          ],
        },
        version: 2,
      }),
    )
    await useChatStore.persist.rehydrate()
    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(2)
    for (const m of messages) expect(m.model).toBeUndefined()
    // 迁移结果回写持久化：localStorage 中同样不再携带 model（version 升至 3）
    const persisted = JSON.parse(localStorage.getItem('wordcraft.chat')!) as {
      version: number
      state: { messages: Array<Record<string, unknown>> }
    }
    expect(persisted.version).toBe(3)
    for (const m of persisted.state.messages) expect(m.model).toBeUndefined()
  })

  it('v3 存档（本就不带 model）rehydrate 保持原样', async () => {
    const archive = {
      state: {
        messages: [
          { id: 'm1', role: 'user', content: 'hi', createdAt: 1 },
          { id: 'm2', role: 'assistant', content: 'ok', createdAt: 2 },
        ],
      },
      version: 3,
    }
    localStorage.setItem('wordcraft.chat', JSON.stringify(archive))
    await useChatStore.persist.rehydrate()
    expect(useChatStore.getState().messages).toEqual(archive.state.messages)
  })
})
