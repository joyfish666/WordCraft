import { describe, expect, it, vi } from 'vitest'
import { describeHttpError, testConnection } from './api'

/** 构造最小合法的 fetch Response（测试只需 status 与 text()） */
function fakeResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  } as unknown as Response
}

describe('describeHttpError', () => {
  it('优先显示服务商返回的 error.message', () => {
    expect(
      describeHttpError(
        new Error('x'),
        400,
        JSON.stringify({ error: { message: 'Model Not Exist' } }),
      ),
    ).toBe('HTTP 400：Model Not Exist')
  })

  it('支持 data.message 兜底', () => {
    expect(
      describeHttpError(new Error('x'), 500, JSON.stringify({ message: 'server error' })),
    ).toBe('HTTP 500：server error')
  })

  it('无详细错误时仅显示状态码', () => {
    expect(describeHttpError(new Error('x'), 503, '')).toBe('HTTP 503，无详细错误信息')
  })

  it('无响应体但带状态码时仅显示状态码', () => {
    expect(describeHttpError(new Error('x'), 400, null)).toBe('HTTP 400，无详细错误信息')
  })

  it('无响应的网络错误显示错误原文', () => {
    expect(describeHttpError(new Error('Network Error'))).toBe('网络错误：Network Error')
  })

  it('完全未知错误回退到兜底文案', () => {
    expect(describeHttpError(null)).toBe('网络错误，无法连接服务')
  })
})

describe('testConnection', () => {
  it('连通成功时返回 ok 与模型名', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(200, JSON.stringify({ model: 'deepseek-v4-flash' })))
    const result = await testConnection({ apiKey: 'sk-test', model: 'deepseek-v4-flash' })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('deepseek-v4-flash')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('401 给出认证失败提示', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeResponse(401, JSON.stringify({ error: { message: 'invalid key' } })))
    const result = await testConnection({ apiKey: 'sk-bad' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('API Key 无效或无权限（401/403）')
    fetchMock.mockRestore()
  })

  it('404 给出模型缺失提示', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(404, ''))
    const result = await testConnection({ apiKey: 'sk-test', model: 'no-such-model' })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('API 可达，但模型不存在，请检查模型名与 Base URL')
    fetchMock.mockRestore()
  })

  it('max_tokens 被拒绝（400）时降级为 max_completion_tokens 重试', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fakeResponse(400, '{"error":{"message":"max_tokens not supported"}}'))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ model: 'o1-mini' })))
    const result = await testConnection({ apiKey: 'sk-test', model: 'o1-mini' })
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]!.body as string) as Record<
      string,
      unknown
    >
    expect(secondBody.max_completion_tokens).toBe(1)
    expect(secondBody.max_tokens).toBeUndefined()
    fetchMock.mockRestore()
  })

  it('网络错误返回可读提示', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'))
    const result = await testConnection({ apiKey: 'sk-test' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('请求失败')
    fetchMock.mockRestore()
  })
})
