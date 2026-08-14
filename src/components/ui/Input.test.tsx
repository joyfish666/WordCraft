import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Input } from './Input'

afterEach(() => {
  cleanup()
})

describe('Input', () => {
  it('渲染 input 带 input 类，属性透传', () => {
    render(<Input placeholder="占位" />)
    expect(screen.getByPlaceholderText('占位')).toHaveClass('input')
  })

  it('禁用态生效（disabled 属性；浏览器原生不派发 change，jsdom fireEvent 不模拟该拦截）', () => {
    render(<Input disabled placeholder="禁" />)
    expect(screen.getByPlaceholderText('禁')).toBeDisabled()
  })

  it('受控值回显（value/onChange 透传）', () => {
    const onChange = vi.fn()
    render(<Input value="abc" onChange={onChange} />)
    const el = screen.getByDisplayValue('abc')
    fireEvent.change(el, { target: { value: 'def' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('自定义 className 追加在 input 类之后', () => {
    render(<Input className="extra" placeholder="p" />)
    expect(screen.getByPlaceholderText('p')).toHaveClass('input', 'extra')
  })

  it('type 透传（password 等）', () => {
    render(<Input type="password" placeholder="密钥" />)
    expect(screen.getByPlaceholderText('密钥')).toHaveAttribute('type', 'password')
  })
})
