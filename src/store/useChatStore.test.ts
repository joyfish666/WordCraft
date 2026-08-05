import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from './useChatStore'

const modelA = createSampleModel()
const modelB = JSON.parse(JSON.stringify(modelA)) as typeof modelA
modelB.root.name = '修改后的小屋'

beforeEach(() => {
  localStorage.clear()
  useChatStore.setState({ messages: [], isGenerating: false, generationStack: [] })
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
