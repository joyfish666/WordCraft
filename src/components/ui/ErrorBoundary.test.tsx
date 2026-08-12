import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../store/useSettingsStore'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom: corrupted data')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ language: 'zh' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('子组件抛错时展示兜底页（不再白屏）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('出错了')).toBeInTheDocument()
    expect(screen.getByText(/boom: corrupted data/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('「重置本地数据」清空 localStorage（jsdom 下 location.reload 不可 spy，仅断言清空）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('wordcraft.settings', '{"state":{"language":"zh"}}')
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: '重置本地数据' }))
    expect(localStorage.getItem('wordcraft.settings')).toBeNull()
    spy.mockRestore()
  })

  it('正常子树不受影响', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})
