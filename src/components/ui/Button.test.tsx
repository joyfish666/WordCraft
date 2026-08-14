import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

afterEach(() => {
  cleanup()
})

describe('Button', () => {
  it('默认 primary 变体：btn + btn--primary 类名', () => {
    render(<Button>点我</Button>)
    expect(screen.getByText('点我')).toHaveClass('btn', 'btn--primary')
  })

  it('ghost / danger 变体类名', () => {
    render(<Button variant="ghost">轻</Button>)
    expect(screen.getByText('轻')).toHaveClass('btn', 'btn--ghost')
    render(<Button variant="danger">删</Button>)
    expect(screen.getByText('删')).toHaveClass('btn', 'btn--danger')
  })

  it('自定义 className 追加在变体之后', () => {
    render(<Button className="extra">x</Button>)
    expect(screen.getByText('x')).toHaveClass('btn', 'btn--primary', 'extra')
  })

  it('禁用态不触发 onClick', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        禁
      </Button>,
    )
    fireEvent.click(screen.getByText('禁'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('其余 button 属性透传（type/title）', () => {
    render(
      <Button type="submit" title="提交">
        提交
      </Button>,
    )
    const el = screen.getByText('提交')
    expect(el).toHaveAttribute('type', 'submit')
    expect(el).toHaveAttribute('title', '提交')
  })
})
