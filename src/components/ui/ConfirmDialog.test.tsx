import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from './ConfirmDialog'
import { useConfirm } from './useConfirm'

declare global {
  interface Window {
    __results?: (boolean | undefined)[]
  }
}

afterEach(() => {
  cleanup()
  delete window.__results
})

function Trigger() {
  const { confirm, alertMessage } = useConfirm()
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const r: (boolean | undefined)[] = []
          window.__results = r
          // 同一异步链连续触发：确认 → 提示 → 确认，三个 Promise 都必须被 resolve（不悬挂）
          void (async () => {
            r.push(await confirm({ title: 'T1', message: 'M1' }))
            await alertMessage({ title: 'T2', message: 'M2' })
            r.push(await confirm({ title: 'T3', message: 'M3' }))
          })()
        }}
      >
        open
      </button>
    </>
  )
}

describe('ConfirmProvider', () => {
  it('展示对话框并 resolve', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(await screen.findByRole('heading', { name: 'T1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await waitFor(() => expect(window.__results?.[0]).toBe(true))
  })

  it('重入请求排队：前一个关闭后按序弹出，全部拿到结果（不悬挂）', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    // 第一个确认框
    expect(await screen.findByRole('heading', { name: 'T1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    // 第二个是 alert（无取消按钮，只有「好」）
    expect(await screen.findByRole('heading', { name: 'T2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '好' }))
    // 第三个确认框
    expect(await screen.findByRole('heading', { name: 'T3' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(window.__results?.[1]).toBe(false))
    // 全部关闭后对话框消失
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'T3' })).not.toBeInTheDocument(),
    )
  })

  it('Escape 关闭 resolve(false)', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(await screen.findByRole('heading', { name: 'T1' })).toBeInTheDocument()
    // 焦点陷阱保证真实场景中焦点在对话框内，Escape 从框内元素冒泡到 overlay 处理
    const confirmBtn = screen.getByRole('button', { name: '确定' })
    fireEvent.keyDown(confirmBtn, { key: 'Escape' })
    await waitFor(() => expect(window.__results?.[0]).toBe(false))
  })

  it('alertMessage 的 Promise 为 void（resolve 不传值）', async () => {
    const spy = vi.fn()
    function AlertTrigger() {
      const { alertMessage } = useConfirm()
      return (
        <button
          type="button"
          onClick={() => {
            void alertMessage({ title: 'A1', message: 'M' }).then(spy)
          }}
        >
          alert
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <AlertTrigger />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'alert' }))
    expect(await screen.findByRole('heading', { name: 'A1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '好' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })
})
