import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../components/ui/ConfirmDialog'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { SceneModel } from '../types/model'
import { useGeneration } from './useGeneration'

/**
 * useGeneration 单元测试：生成链路的编排分支（无 key 保留草稿 / 成功 /
 * 冲突 cancel / 冲突 apply / 中止）。generateModelFromChat 整模块 mock，
 * 其余 store 全部真实（与 HomePage 集成测试互补，HomePage 只点了冲突两个分支）。
 */

vi.mock('../lib/chat', () => ({
  generateModelFromChat: vi.fn(),
  ChatGenerationError: class ChatGenerationError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
}))

const mockGenerate = vi.mocked(generateModelFromChat)

function resetStores() {
  localStorage.clear()
  useSettingsStore.setState({
    apiKeys: [],
    activeKeyId: null,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    thinking: 'disabled',
    language: 'zh',
  })
  useChatStore.setState({
    messages: [],
    isGenerating: false,
    generationStack: [],
    editOps: [],
  })
  useModelStore.setState({
    scene: null,
    selectedId: null,
    focusId: null,
    stepSize: 0.5,
    gizmoMode: 'translate',
    planTool: 'select',
    openingKind: 'door',
    showPlanDims: true,
    screenshotMode: false,
    initialPositions: {},
    past: [],
    future: [],
  })
  useProjectStore.setState({ currentId: null, currentName: null, dirty: false, savedJson: null })
}

/** 挂载 hook：wrapper 带 ConfirmProvider（冲突确认对话框由它渲染） */
function setup(draft: string) {
  const setDraft = vi.fn()
  const setChatCollapsed = vi.fn()
  const utils = renderHook(() => useGeneration({ draft, setDraft, setChatCollapsed }), {
    wrapper: ConfirmProvider,
  })
  return { setDraft, setChatCollapsed, ...utils }
}

function sampleScene(): SceneModel {
  return createSampleModel()
}

/** setScene 会 normalizeContainment（产生新引用），场景比较用序列化（内容相等即可） */
function sceneJson(s: SceneModel | null): string {
  return JSON.stringify(s)
}

beforeEach(() => {
  resetStores()
  mockGenerate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('useGeneration', () => {
  it('无 API Key：保留草稿、追加错误消息、不进入生成态', async () => {
    const { setDraft, result } = setup('设计一个房子')
    await act(async () => {
      await result.current.send()
    })
    expect(setDraft).not.toHaveBeenCalled() // 草稿不清空（坑 70）
    const messages = useChatStore.getState().messages
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'error',
      content: expect.stringContaining('API Key'),
    })
    expect(useChatStore.getState().isGenerating).toBe(false)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('空白输入不发送', async () => {
    const { result } = setup('   ')
    await act(async () => {
      await result.current.send()
    })
    expect(useChatStore.getState().messages).toHaveLength(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('生成成功：追加 user/assistant 消息、替换场景、记录生成历史、解绑项目', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    const model = sampleScene()
    mockGenerate.mockResolvedValue({ reply: '{"version":3,"ops":[]}', model })
    const { result, setDraft } = setup('生成一个示例')
    await act(async () => {
      await result.current.send()
    })
    expect(setDraft).toHaveBeenCalledWith('')
    const msgs = useChatStore.getState().messages
    expect(msgs[0]).toMatchObject({ role: 'user', content: '生成一个示例' })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '{"version":3,"ops":[]}' })
    expect(sceneJson(useModelStore.getState().scene)).toBe(sceneJson(model))
    expect(useChatStore.getState().generationStack).toHaveLength(0) // 生成前无场景，不记历史
    expect(useProjectStore.getState().currentId).toBeNull()
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('生成成功且生成前有场景：pushGenerationHistory 记录基线供撤销生成', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    const base = sampleScene()
    const model = sampleScene()
    useModelStore.setState({ scene: base })
    mockGenerate.mockResolvedValue({ reply: 'ok', model })
    const { result } = setup('再改一下')
    await act(async () => {
      await result.current.send()
    })
    expect(useChatStore.getState().generationStack).toEqual([base])
  })

  it('生成期间场景已变化：冲突确认选「取消」保留编辑', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    const base = sampleScene()
    const edited = sampleScene()
    const model = sampleScene()
    useModelStore.setState({ scene: base })
    let resolveGen: (v: { reply: string; model: SceneModel }) => void = () => {}
    mockGenerate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGen = resolve
        }),
    )
    const { result } = setup('生成期间我拖了房间')
    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.send()
    })
    // 生成未返回时用户手动编辑了场景（打开项目/拖拽等）
    act(() => {
      useModelStore.setState({ scene: edited })
    })
    // 生成返回 → send 继续 → 冲突确认对话框弹出（confirm 在等待用户）
    await act(async () => {
      resolveGen({ reply: 'x', model })
    })
    // 点「取消」→ confirm resolve(false) → send 收尾
    await act(async () => {
      fireEvent.click(screen.getByText('取消'))
      await sendPromise
    })
    expect(useModelStore.getState().scene).toBe(edited) // 用户编辑保留（坑 70）
    const messages = useChatStore.getState().messages
    expect(messages[messages.length - 1]).toMatchObject({ role: 'error' })
  })

  it('生成期间场景已变化：冲突确认选「确定」覆盖为生成结果', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    const base = sampleScene()
    const edited = sampleScene()
    const model = sampleScene()
    useModelStore.setState({ scene: base })
    let resolveGen: (v: { reply: string; model: SceneModel }) => void = () => {}
    mockGenerate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGen = resolve
        }),
    )
    const { result } = setup('覆盖吧')
    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.send()
    })
    act(() => {
      useModelStore.setState({ scene: edited })
    })
    await act(async () => {
      resolveGen({ reply: 'x', model })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('确定'))
      await sendPromise
    })
    expect(sceneJson(useModelStore.getState().scene)).toBe(sceneJson(model))
  })

  it('生成失败（无 JSON）：追加错误消息、不替换场景', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    mockGenerate.mockRejectedValue(
      new ChatGenerationError('模型返回内容中未找到 JSON，请重试', 'no-json'),
    )
    const { result } = setup('触发失败')
    await act(async () => {
      await result.current.send()
    })
    const messages = useChatStore.getState().messages
    expect(messages[messages.length - 1]).toMatchObject({ role: 'error' })
    expect(useModelStore.getState().scene).toBeNull()
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('卸载时中止进行中的请求：不再替换场景并提示已取消', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    mockGenerate.mockImplementation(
      (opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const { result, unmount } = setup('生成中卸载')
    act(() => {
      void result.current.send()
    })
    expect(useChatStore.getState().isGenerating).toBe(true)
    await act(async () => {
      unmount() // cleanup → abortRef.abort() → mock reject → 已取消生成
    })
    expect(useModelStore.getState().scene).toBeNull()
    const messages = useChatStore.getState().messages
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'error',
      content: '已取消生成',
    })
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('撤销生成：恢复生成前场景并移除对应消息对', async () => {
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'key', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    const base = sampleScene()
    const model = sampleScene()
    useModelStore.setState({ scene: base })
    mockGenerate.mockResolvedValue({ reply: 'ok', model })
    const { result } = setup('再改一下')
    await act(async () => {
      await result.current.send()
    })
    expect(sceneJson(useModelStore.getState().scene)).toBe(sceneJson(model))
    expect(useChatStore.getState().messages).toHaveLength(2)
    act(() => {
      result.current.undoGeneration()
    })
    // 撤销生成经 setScene 恢复（normalize 后新引用），内容与基线一致
    expect(sceneJson(useModelStore.getState().scene)).toBe(sceneJson(base))
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})
