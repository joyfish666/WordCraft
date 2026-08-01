import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGenerationError, extractModelJson, generateModelFromChat } from './chat'

const mockPost = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ post: mockPost })),
    isAxiosError: (error: unknown) =>
      Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  },
}))

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
  mockPost.mockReset()
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

describe('generateModelFromChat', () => {
  it('校验通过时返回模型与回复', async () => {
    mockPost.mockResolvedValue({
      data: { choices: [{ message: { content: validModelJson() } }] },
    })
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

  it('请求体包含系统提示与历史对话', async () => {
    mockPost.mockResolvedValue({
      data: { choices: [{ message: { content: validModelJson() } }] },
    })
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [{ role: 'user', content: '之前的设计' }],
      userInput: '再加一张床',
    })
    const [, body] = mockPost.mock.calls[0] as [
      string,
      { messages: { role: string; content: string }[] },
    ]
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(body.messages[0].content).toContain('house')
  })

  it('未找到 JSON 时抛出 no-json 错误', async () => {
    mockPost.mockResolvedValue({
      data: { choices: [{ message: { content: '抱歉，我无法完成' } }] },
    })
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'no-json' })
  })

  it('Schema 校验失败时抛出 invalid-schema 错误', async () => {
    mockPost.mockResolvedValue({
      data: { choices: [{ message: { content: '{"version":1,"root":{"type":"house"}}' } }] },
    })
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toBeInstanceOf(ChatGenerationError)
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-schema' })
  })

  it('HTTP 错误时抛出 http 错误', async () => {
    mockPost.mockRejectedValue(new Error('network down'))
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'http' })
  })
})
