import { describe, expect, it } from 'vitest'
import { describeAxiosError } from './api'

/** 构造一个带 isAxiosError 标记的假 axios 错误 */
function fakeAxiosError(overrides: Record<string, unknown> = {}): unknown {
  return { isAxiosError: true, message: '', code: '', response: undefined, ...overrides }
}

describe('describeAxiosError', () => {
  it('优先显示服务商返回的 error.message', () => {
    const err = fakeAxiosError({
      response: { status: 400, data: { error: { message: 'Model Not Exist' } } },
    })
    expect(describeAxiosError(err)).toBe('HTTP 400：Model Not Exist')
  })

  it('支持 data.message 兜底', () => {
    const err = fakeAxiosError({ response: { status: 500, data: { message: 'server error' } } })
    expect(describeAxiosError(err)).toBe('HTTP 500：server error')
  })

  it('无详细错误时仅显示状态码', () => {
    const err = fakeAxiosError({ response: { status: 503, data: {} } })
    expect(describeAxiosError(err)).toBe('HTTP 503，无详细错误信息')
  })

  it('超时错误给出可读提示', () => {
    const err = fakeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })
    expect(describeAxiosError(err)).toBe('请求超时，请检查网络或稍后重试')
  })

  it('无响应的网络错误显示错误原文', () => {
    const err = fakeAxiosError({ message: 'Network Error' })
    expect(describeAxiosError(err)).toBe('网络错误：Network Error')
  })

  it('非 axios 错误回退到 message', () => {
    expect(describeAxiosError(new Error('boom'))).toBe('boom')
  })
})
