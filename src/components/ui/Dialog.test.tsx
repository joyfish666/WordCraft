import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

/**
 * Dialog 通用模态框 a11y 行为测试（坑 C9 收敛后的语义）：
 * 打开聚焦首个可聚焦元素 / Tab 焦点陷阱（首尾循环）/ Escape 关闭 /
 * 遮罩点击关闭（内容区不冒泡）/ 关闭焦点归还 / body 滚动锁。
 * Dialog 用 createPortal 到 document.body，断言查 body（screen 已覆盖）。
 */

function renderDialog(open = true) {
  const onClose = vi.fn()
  render(
    <>
      <button>trigger</button>
      <Dialog open={open} onClose={onClose} title="对话框标题">
        <button>第一个</button>
        <button>第二个</button>
      </Dialog>
    </>,
  )
  return { onClose }
}

afterEach(() => {
  cleanup()
})

describe('Dialog（a11y 行为）', () => {
  it('打开时聚焦首个可聚焦元素', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByText('第一个'))
  })

  it('Tab 焦点陷阱：末尾 Tab 回到首个，首个 Shift+Tab 到末尾', () => {
    renderDialog()
    const first = screen.getByText('第一个')
    const last = screen.getByText('第二个')
    const overlay = screen.getByRole('dialog')
    // 聚焦首个时 Shift+Tab → 循环到末尾
    first.focus()
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    // 聚焦末尾时 Tab → 循环回首个
    fireEvent.keyDown(overlay, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })

  it('Escape 关闭', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('遮罩点击关闭；内容区点击不冒泡关闭', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('dialog')) // 点击遮罩（overlay 自身）
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('第一个')) // 内容区 stopPropagation
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭时焦点归还触发元素', () => {
    const { rerender } = render(
      <>
        <button>trigger</button>
        <Dialog open={false} onClose={vi.fn()} title="对话框标题">
          <button>第一个</button>
        </Dialog>
      </>,
    )
    const trigger = screen.getByText('trigger')
    trigger.focus()
    rerender(
      <>
        <button>trigger</button>
        <Dialog open onClose={vi.fn()} title="对话框标题">
          <button>第一个</button>
        </Dialog>
      </>,
    )
    expect(document.activeElement).toBe(screen.getByText('第一个'))
    rerender(
      <>
        <button>trigger</button>
        <Dialog open={false} onClose={vi.fn()} title="对话框标题">
          <button>第一个</button>
        </Dialog>
      </>,
    )
    expect(document.activeElement).toBe(trigger)
  })

  it('打开时锁定 body 滚动，关闭后恢复', () => {
    const { rerender } = render(
      <Dialog open onClose={vi.fn()} title="t">
        <button>a</button>
      </Dialog>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <Dialog open={false} onClose={vi.fn()} title="t">
        <button>a</button>
      </Dialog>,
    )
    expect(document.body.style.overflow).toBe('')
  })

  it('关闭时不渲染（portal 卸载）', () => {
    renderDialog(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('第一个')).not.toBeInTheDocument()
  })
})
