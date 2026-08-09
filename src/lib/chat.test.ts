import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGenerationError, extractModelJson, generateModelFromChat } from './chat'

const mockFetch = vi.fn()

/** 构造一个返回 SSE 流（单条 delta + [DONE]）的 Response */
function sseResponse(content: string): Response {
  const data = JSON.stringify({ choices: [{ delta: { content } }] })
  const body = `data: ${data}\n\ndata: [DONE]\n\n`
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

/** 构造一个非 2xx 的错误 Response */
function errorResponse(status: number, body: string): Response {
  return new Response(body, { status })
}

function respondWith(content: string) {
  mockFetch.mockImplementation(() => Promise.resolve(sseResponse(content)))
}

function respondWithError(status: number, body: string) {
  mockFetch.mockImplementation(() => Promise.resolve(errorResponse(status, body)))
}

/** 一个合法的 v2 auto 走廊型模型 */
function validModelJson(): string {
  return JSON.stringify({
    version: 2,
    root: {
      id: 'h1',
      type: 'house',
      name: '示例房',
      dimensions: { length: 7, width: 4, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living' } },
      children: [
        {
          id: 'master',
          type: 'room',
          name: '主卧',
          dimensions: { length: 3, width: 3, height: 2.8 },
          side: 'left',
          children: [
            {
              id: 'bed',
              type: 'furniture',
              name: '双人床',
              dimensions: { length: 2, width: 1.5, height: 0.5 },
              position: { x: 0, y: 0.25, z: 0.3 },
            },
          ],
        },
        {
          id: 'living',
          type: 'room',
          name: '客厅',
          dimensions: { length: 4, width: 3, height: 2.8 },
          side: 'right',
          children: [],
        },
      ],
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractModelJson', () => {
  it('提取纯 JSON', () => {
    expect(extractModelJson('{"a":1}')).toBe('{"a":1}')
  })

  it('提取 markdown 代码块中的 JSON', () => {
    const text = '```json\n{"a":1}\n```'
    expect(extractModelJson(text)).toBe('{"a":1}')
  })

  it('从夹杂散文的文本中提取 JSON', () => {
    const text = '好的，这是设计：{"version":2} 以上就是方案。'
    expect(extractModelJson(text)).toBe('{"version":2}')
  })

  it('无 JSON 时返回 null', () => {
    expect(extractModelJson('抱歉，我不明白')).toBeNull()
    expect(extractModelJson('')).toBeNull()
  })
})

describe('generateModelFromChat', () => {
  it('流式 v2 响应经布局解析后返回模型', async () => {
    respondWith(validModelJson())
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    // 走廊被引擎生成，房间已平铺
    const rooms = result.model.root.levels[0].rooms
    expect(rooms.some((c) => c.name === '走廊')).toBe(true)
    expect(rooms.some((c) => c.name === '主卧')).toBe(true)
  })

  it('请求体启用流式并包含系统提示、历史与思考模式', async () => {
    respondWith(validModelJson())
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [{ role: 'user', content: '之前的设计' }],
      userInput: '再加一个卧室',
      thinking: 'disabled',
    })
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    expect(url).toContain('/chat/completions')
    const body = JSON.parse(init.body) as {
      stream: boolean
      thinking: { type: string }
      messages: { role: string; content: string }[]
    }
    expect(body.stream).toBe(true)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(body.messages[0].content).toContain('layout')
  })

  it('思考模式为 default 时不发送 thinking 字段', async () => {
    respondWith(validModelJson())
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: 'x',
      thinking: 'default',
    })
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as { thinking?: { type: string } }
    expect(body.thinking).toBeUndefined()
  })

  it('未找到 JSON 时抛出 no-json 错误', async () => {
    respondWith('抱歉，我无法完成')
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'no-json' })
  })

  it('Schema 校验失败时抛出 invalid-schema 错误', async () => {
    respondWith('{"version":2,"root":{"type":"house"}}')
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toBeInstanceOf(ChatGenerationError)
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-schema' })
  })

  it('HTTP 错误时透传服务商错误信息', async () => {
    respondWithError(401, '{"error":{"message":"Auth Fails"}}')
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'http' })
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toThrow(/Auth Fails/)
  })

  it('网络错误时抛出 http 错误', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'http' })
  })
})
