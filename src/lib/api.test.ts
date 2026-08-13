import { describe, expect, it, vi } from 'vitest'
import { describeHttpError, streamChatCompletion, testConnection } from './api'

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

// ---------------------------------------------------------------------------
// streamChatCompletion（SSE 流式解析）
// ---------------------------------------------------------------------------

/** 构造带 ReadableStream 响应体的最小 Response（按分片序列喂入 SSE 字节流） */
function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return { ok: status >= 200 && status < 300, status, body: stream } as unknown as Response
}

describe('streamChatCompletion', () => {
  const opts = { apiKey: 'sk-test', model: 'm' }

  it('累积多段 delta 并在 [DONE] 后结束，逐段回调 onChunk', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        streamingResponse([
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
          'data: {"choices":[{"delta":{"content":"世界"}}]}\n',
          'data: [DONE]\n',
        ]),
      )
    const deltas: string[] = []
    const full = await streamChatCompletion(opts, [{ role: 'user', content: 'hi' }], (d) =>
      deltas.push(d),
    )
    expect(full).toBe('你好世界')
    expect(deltas).toEqual(['你好', '世界'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('一条 data 行被切成多个分片仍正确拼接（buffer 边界）', async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"跨分片内容"}}]}\n'
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        streamingResponse([payload.slice(0, 7), payload.slice(7, 30), payload.slice(30)]),
      )
    const full = await streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])
    expect(full).toBe('跨分片内容')
    fetchMock.mockRestore()
  })

  it('忽略坏行（非 data: 前缀、空行、解析失败的 JSON）', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        streamingResponse([
          ': keep-alive comment\n',
          '\n',
          'data: not-json\n',
          'data: {"choices":[{"delta":{"content":"有效"}}]}\n',
          'data: [DONE]\n',
        ]),
      )
    const full = await streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])
    expect(full).toBe('有效')
    fetchMock.mockRestore()
  })

  it('delta 为空字符串不触发 onChunk 回调', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        streamingResponse(['data: {"choices":[{"delta":{}}]}\n', 'data: [DONE]\n']),
      )
    const deltas: string[] = []
    const full = await streamChatCompletion(opts, [{ role: 'user', content: 'hi' }], (d) =>
      deltas.push(d),
    )
    expect(full).toBe('')
    expect(deltas).toEqual([])
    fetchMock.mockRestore()
  })

  it('流结束未收到 [DONE] 时返回已累积内容', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(streamingResponse(['data: {"choices":[{"delta":{"content":"未完"}}]}\n']))
    const full = await streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])
    expect(full).toBe('未完')
    fetchMock.mockRestore()
  })

  it('HTTP 错误时透传服务商错误信息', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 429,
      ok: false,
      body: null,
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'rate limited' } })),
    } as unknown as Response)
    await expect(streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'rate limited',
    )
    fetchMock.mockRestore()
  })

  it('响应体为空（无 body）时报数据流错误', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    } as unknown as Response)
    await expect(streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '数据流',
    )
    fetchMock.mockRestore()
  })

  it('fetch 网络层失败时报请求失败', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'))
    await expect(streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '请求失败',
    )
    fetchMock.mockRestore()
  })

  it('流读取中断（非中止）时报读取中断', async () => {
    const fakeBody = {
      getReader: () => ({
        read: vi
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: fakeBody,
    } as unknown as Response)
    await expect(streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '读取响应流中断（boom）',
    )
    fetchMock.mockRestore()
  })

  it('用户主动中止（AbortError）不被误报为超时之外的网络错误', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(streamChatCompletion(opts, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      '请求超时',
    )
    fetchMock.mockRestore()
  })
})
