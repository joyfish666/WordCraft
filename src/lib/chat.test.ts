import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatGenerationError,
  extractModelJson,
  generateModelFromChat,
  normalizeModelPayload,
} from './chat'

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

/** 让 fetch 每次调用返回全新的成功响应（避免流被消费后复用） */
function respondWith(content: string) {
  mockFetch.mockImplementation(() => Promise.resolve(sseResponse(content)))
}

function respondWithError(status: number, body: string) {
  mockFetch.mockImplementation(() => Promise.resolve(errorResponse(status, body)))
}

function validModelJson(): string {
  return JSON.stringify({
    version: 1,
    root: {
      id: 'h1',
      type: 'house',
      name: '小屋',
      dimensions: { length: 4, width: 3, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      children: [
        {
          id: 'r1',
          type: 'room',
          name: '卧室',
          dimensions: { length: 3, width: 3, height: 2.8 },
          position: { x: 0, y: 1.4, z: 0 },
          children: [
            {
              id: 'b1',
              type: 'furniture',
              name: '双人床',
              dimensions: { length: 2, width: 1.5, height: 0.5 },
              position: { x: 0, y: 0.25, z: 0 },
            },
          ],
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
    const text = '好的，这是设计：{"version":1} 以上就是方案。'
    expect(extractModelJson(text)).toBe('{"version":1}')
  })

  it('无 JSON 时返回 null', () => {
    expect(extractModelJson('抱歉，我不明白')).toBeNull()
    expect(extractModelJson('')).toBeNull()
  })
})

describe('normalizeModelPayload', () => {
  it('接受标准 { version, root } 结构', () => {
    const normalized = normalizeModelPayload(JSON.parse(validModelJson()))
    expect(normalized?.root.name).toBe('小屋')
  })

  it('接受裸 house 容器（自动包装）', () => {
    const raw = JSON.parse(validModelJson()).root
    const normalized = normalizeModelPayload(raw)
    expect(normalized?.root.name).toBe('小屋')
    expect(normalized?.version).toBe(1)
  })

  it('接受 { rooms: [...] } 并推断整屋尺寸', () => {
    const room = JSON.parse(validModelJson()).root.children[0]
    const normalized = normalizeModelPayload({ rooms: [room], name: '一居室' })
    expect(normalized?.root.name).toBe('一居室')
    expect(normalized?.root.children).toHaveLength(1)
    expect(normalized?.root.dimensions.length).toBeGreaterThan(0)
  })

  it('接受顶层数组（多个房间）', () => {
    const { children } = JSON.parse(validModelJson()).root
    const normalized = normalizeModelPayload(children)
    expect(normalized?.root.children).toHaveLength(children.length)
  })

  it('无法识别时返回 null', () => {
    expect(normalizeModelPayload({ foo: 'bar' })).toBeNull()
    expect(normalizeModelPayload(null)).toBeNull()
  })
})

describe('generateModelFromChat', () => {
  it('流式响应校验通过时返回模型', async () => {
    respondWith(validModelJson())
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个卧室',
    })
    expect(result.model.root.name).toBe('小屋')
    const room = result.model.root.children[0]
    expect(room.type).toBe('room')
    if (room.type === 'room') {
      expect(room.children[0].type).toBe('furniture')
    }
  })

  it('请求体启用流式并包含系统提示与历史', async () => {
    respondWith(validModelJson())
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [{ role: 'user', content: '之前的设计' }],
      userInput: '再加一张床',
    })
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    expect(url).toContain('/chat/completions')
    const body = JSON.parse(init.body) as {
      stream: boolean
      messages: { role: string; content: string }[]
    }
    expect(body.stream).toBe(true)
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(body.messages[0].content).toContain('house')
  })

  it('流式回调收到内容增量', async () => {
    respondWith(validModelJson())
    const chunks: string[] = []
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: 'x',
      onChunk: (delta) => chunks.push(delta),
    })
    expect(chunks.join('')).toBe(validModelJson())
  })

  it('模型输出裸容器（无 root 包装）时也能正常生成', async () => {
    const bareRoot = JSON.parse(validModelJson()).root
    respondWith(JSON.stringify(bareRoot))
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个卧室',
    })
    expect(result.model.root.name).toBe('小屋')
  })

  it('未找到 JSON 时抛出 no-json 错误', async () => {
    respondWith('抱歉，我无法完成')
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'no-json' })
  })

  it('Schema 校验失败时抛出 invalid-schema 错误', async () => {
    respondWith('{"version":1,"root":{"type":"house"}}')
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
