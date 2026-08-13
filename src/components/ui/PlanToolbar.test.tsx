import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanToolbar } from './PlanToolbar'

function renderToolbar(overrides: Partial<Parameters<typeof PlanToolbar>[0]> = {}) {
  const props = {
    planTool: 'select' as const,
    openingKind: 'door' as const,
    showPlanDims: true,
    mobileCompact: false,
    onSetPlanTool: vi.fn(),
    onSetOpeningKind: vi.fn(),
    onToggleDims: vi.fn(),
    ...overrides,
  }
  render(<PlanToolbar {...props} />)
  return props
}

afterEach(() => {
  cleanup()
})

describe('PlanToolbar', () => {
  it('桌面端常驻工具行：切换工具与尺寸开关触发回调', () => {
    const props = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    expect(props.onSetPlanTool).toHaveBeenCalledWith('move')
    fireEvent.click(screen.getByRole('button', { name: '顶点' }))
    expect(props.onSetPlanTool).toHaveBeenCalledWith('vertex')
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }))
    expect(props.onToggleDims).toHaveBeenCalled()
  })

  it('当前工具高亮激活态', () => {
    renderToolbar({ planTool: 'merge' })
    const mergeBtn = screen.getByRole('button', { name: '合并' })
    expect(mergeBtn.className).toContain('segmented__btn--active')
    expect(screen.getByRole('button', { name: '选择' }).className).not.toContain('--active')
  })

  it('选中「门窗」工具时显示门/窗切换', () => {
    const props = renderToolbar({ planTool: 'opening' })
    fireEvent.click(screen.getByRole('button', { name: '窗' }))
    expect(props.onSetOpeningKind).toHaveBeenCalledWith('window')
  })

  it('拆分工具提示包含操作说明', () => {
    renderToolbar({ planTool: 'split' })
    expect(screen.getByText(/拆成两间/)).toBeTruthy()
  })

  it('合并工具提示包含操作说明', () => {
    renderToolbar({ planTool: 'merge' })
    // 提示条文案与工具栏按钮文案同现
    expect(screen.getAllByText(/合并/).length).toBeGreaterThan(1)
  })

  it('选择工具无操作提示', () => {
    renderToolbar({ planTool: 'select' })
    expect(screen.queryByText(/拖动画一条线/)).toBeNull()
  })

  it('移动端：工具按钮 + 尺寸按钮 + 弹出面板（选工具即关闭）', () => {
    const props = renderToolbar({ mobileCompact: true })
    // 面板未打开时不显示工具列表
    expect(screen.queryByRole('toolbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /工具/ }))
    // 弹出面板含工具，选择后自动关闭
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    expect(props.onSetPlanTool).toHaveBeenCalledWith('move')
    expect(screen.queryByRole('toolbar')).toBeNull()
    // 再次打开后点遮罩关闭
    fireEvent.click(screen.getByRole('button', { name: /工具/ }))
    const backdrop = document.querySelector('.plan-toolbar__backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})
