import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../store/useSettingsStore'
import { HomeToolbar, type HomeToolbarProps } from './HomeToolbar'

function renderToolbar(overrides: Partial<HomeToolbarProps> = {}) {
  const props: HomeToolbarProps = {
    canClear: true,
    canSave: true,
    canUndo: true,
    canRedo: true,
    undoTitle: '撤销 (Ctrl+Z)',
    redoTitle: '重做 (Ctrl+Y / Ctrl+Shift+Z)',
    saveTitle: '保存到本地项目库',
    chatCollapsed: true,
    hasApiKey: true,
    onLoadSample: vi.fn(),
    onClearScene: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onOpenLibrary: vi.fn(),
    onShare: vi.fn(),
    onScreenshot: vi.fn(),
    onHelp: vi.fn(),
    onToggleChat: vi.fn(),
    ...overrides,
  }
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HomeToolbar {...props} />
    </MemoryRouter>,
  )
  return props
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({
    apiKeys: [],
    activeKeyId: null,
    language: 'zh',
  })
})

afterEach(() => {
  cleanup()
})

describe('HomeToolbar', () => {
  it('场景操作按钮触发对应回调', () => {
    const props = renderToolbar()
    fireEvent.click(screen.getByTitle('加载示例模型'))
    expect(props.onLoadSample).toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('清空当前场景'))
    expect(props.onClearScene).toHaveBeenCalled()
  })

  it('无场景时清空/保存/撤销/重做禁用', () => {
    renderToolbar({ canClear: false, canSave: false, canUndo: false, canRedo: false })
    expect(screen.getByTitle('清空当前场景')).toBeDisabled()
    expect(screen.getByTitle('保存到本地项目库')).toBeDisabled()
    expect(screen.getByTitle('撤销 (Ctrl+Z)')).toBeDisabled()
    expect(screen.getByTitle('重做 (Ctrl+Y / Ctrl+Shift+Z)')).toBeDisabled()
  })

  it('撤销/重做按钮触发回调', () => {
    const props = renderToolbar()
    fireEvent.click(screen.getByTitle('撤销 (Ctrl+Z)'))
    fireEvent.click(screen.getByTitle('重做 (Ctrl+Y / Ctrl+Shift+Z)'))
    expect(props.onUndo).toHaveBeenCalled()
    expect(props.onRedo).toHaveBeenCalled()
  })

  it('分享/截图/帮助/对话按钮触发回调', () => {
    const props = renderToolbar()
    fireEvent.click(screen.getByLabelText('分享'))
    expect(props.onShare).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('截图'))
    expect(props.onScreenshot).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('操作说明'))
    expect(props.onHelp).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(props.onToggleChat).toHaveBeenCalled()
  })

  it('对话展开时「对话」按钮带激活态', () => {
    renderToolbar({ chatCollapsed: false })
    const btn = screen.getByRole('button', { name: '对话' })
    expect(btn.className).toContain('toolbar__btn--active')
  })

  it('未配置 API Key 时显示警示徽章（链接到设置页）', () => {
    renderToolbar({ hasApiKey: false })
    const badge = screen.getByText(/未配置 API Key · 前往设置/)
    expect(badge.closest('a')).toHaveAttribute('href', '/settings')
  })

  it('已配置 API Key 时显示正常徽章', () => {
    renderToolbar({ hasApiKey: true })
    expect(screen.getByText('API Key 已配置')).toBeInTheDocument()
  })

  it('语言切换按钮在 zh/en 间翻转', () => {
    renderToolbar()
    // zh 界面下按钮可访问名 = 当前语言描述动作「切换为英文」
    fireEvent.click(screen.getByRole('button', { name: '切换为英文' }))
    expect(useSettingsStore.getState().language).toBe('en')
  })
})
