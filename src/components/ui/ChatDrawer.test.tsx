import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleModel } from '../../lib/sampleModel'
import type { ChatMessageItem } from '../../store/useChatStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { ChatDrawer, type ChatDrawerProps } from './ChatDrawer'

function renderDrawer(overrides: Partial<ChatDrawerProps> = {}) {
  const props: ChatDrawerProps = {
    collapsed: false,
    messages: [],
    isGenerating: false,
    elapsed: 0,
    canUndoGeneration: false,
    canClear: false,
    hasApiKey: true,
    draft: '',
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onToggle: vi.fn(),
    onUndoGeneration: vi.fn(),
    onClearConversation: vi.fn(),
    ...overrides,
  }
  render(<ChatDrawer {...props} />)
  return props
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ language: 'zh' })
})

afterEach(() => {
  cleanup()
})

describe('ChatDrawer', () => {
  it('输入草稿并点击发送按钮触发 onSend', () => {
    const props = renderDrawer({ draft: '设计一个卧室' })
    fireEvent.change(screen.getByPlaceholderText(/帮我设计/), { target: { value: '换个说法' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('换个说法')
    fireEvent.click(screen.getByRole('button', { name: '生成模型' }))
    expect(props.onSend).toHaveBeenCalled()
  })

  it('草稿为空或生成中时发送按钮禁用', () => {
    renderDrawer({ draft: '', isGenerating: false })
    expect(screen.getByRole('button', { name: '生成模型' })).toBeDisabled()
  })

  it('输入框内 Enter 触发发送、Shift+Enter 不触发', () => {
    const props = renderDrawer({ draft: '设计一个卧室' })
    const textarea = screen.getByPlaceholderText(/帮我设计/)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalled()
  })

  it('渲染用户/助手/错误消息；携带模型的助手消息显示生成摘要', () => {
    const model = createSampleModel()
    const messages: ChatMessageItem[] = [
      { id: 'm1', role: 'user', content: '设计一个小屋', createdAt: 1 },
      { id: 'm2', role: 'assistant', content: '{"version":3,"ops":[]}', model, createdAt: 2 },
      { id: 'm3', role: 'error', content: '出错了', createdAt: 3 },
    ]
    renderDrawer({ messages })
    expect(screen.getByText('设计一个小屋')).toBeInTheDocument()
    expect(screen.getByText(/已生成「示例小屋」模型，共 \d+ 个模块/)).toBeInTheDocument()
    expect(screen.getByText('出错了')).toBeInTheDocument()
  })

  it('未配置 API Key 时显示提示条', () => {
    renderDrawer({ hasApiKey: false })
    expect(screen.getByText(/尚未配置 API Key，暂时无法生成/)).toBeInTheDocument()
  })

  it('「撤销生成」与「清空对话」按钮按状态禁用', () => {
    renderDrawer({ canUndoGeneration: false, canClear: false })
    expect(screen.getByRole('button', { name: /撤销生成/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空对话' })).toBeDisabled()
  })

  it('折叠状态切换：按钮触发 onToggle 且 aria-expanded 反映展开状态', () => {
    const props = renderDrawer({ collapsed: true })
    const toggle = screen.getByTitle('展开对话')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(props.onToggle).toHaveBeenCalled()
  })
})
