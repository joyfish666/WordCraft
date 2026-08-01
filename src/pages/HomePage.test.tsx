import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { HomePage } from './HomePage'

// jsdom 无 WebGL，mock 掉 3D 视口以聚焦对话交互
vi.mock('../components/viewport/SceneViewer', () => ({
  SceneViewer: forwardRef(function MockSceneViewer() {
    return <div data-testid="scene-viewer" />
  }),
}))

vi.mock('../lib/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chat')>()
  return { ...actual, generateModelFromChat: vi.fn() }
})

const mockGenerate = vi.mocked(generateModelFromChat)

function resetStores() {
  useChatStore.setState({ messages: [], isGenerating: false })
  useModelStore.setState({ scene: null, selectedId: null })
  useSettingsStore.setState({
    apiKeys: [],
    activeKeyId: null,
    defaultBaseUrl: '',
    defaultModel: 'gpt-3.5-turbo',
    thinking: 'disabled',
    colorMode: 'standard',
    wireframe: { enabled: true, lineWidth: 1 },
  })
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/帮我设计/), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '生成模型' }))
}

beforeEach(() => {
  localStorage.clear()
  resetStores()
  mockGenerate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('HomePage 对话交互', () => {
  it('未配置 API Key 时点击生成，提示前往设置且不调用模型', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>,
    )
    typeAndSend('设计一个卧室')
    expect(await screen.findByText(/尚未配置 API Key/)).toBeInTheDocument()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('生成成功后显示摘要并更新场景模型', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    mockGenerate.mockResolvedValue({ reply: '', model: createSampleModel() })

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>,
    )
    typeAndSend('设计一个小屋')

    expect(await screen.findByText(/已生成「示例小屋」模型/)).toBeInTheDocument()
    await waitFor(() => {
      expect(useModelStore.getState().scene?.root.name).toBe('示例小屋')
    })
  })

  it('模型返回业务错误时在对话中展示错误信息', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    mockGenerate.mockRejectedValue(new ChatGenerationError('模型请求失败：401 Unauthorized', 'http'))

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>,
    )
    typeAndSend('设计一个卧室')

    expect(await screen.findByText(/模型请求失败：401 Unauthorized/)).toBeInTheDocument()
    expect(useModelStore.getState().scene).toBeNull()
  })
})
