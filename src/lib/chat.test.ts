import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatGenerationError,
  buildEditOpsLog,
  buildSceneSummary,
  extractModelJson,
  generateModelFromChat,
  repairTruncatedJson,
} from './chat'
import { emptyScene } from './executor'
import type { SceneModel } from '../types/model'

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

/** 一个合法的 ops 输出：macro corridor 整体布局 */
function validOpsJson(): string {
  return JSON.stringify({
    version: 3,
    ops: [
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 3, width: 3, height: 2.8 },
              side: 'left',
              furniture: [
                {
                  id: 'bed',
                  name: '双人床',
                  dimensions: { length: 2, width: 1.5, height: 0.5 },
                  position: { x: 0, y: 0.25, z: 0.3 },
                },
              ],
            },
            {
              id: 'living',
              name: '客厅',
              dimensions: { length: 4, width: 3, height: 2.8 },
              side: 'right',
            },
          ],
        },
      },
    ],
  })
}

/** 一个合法的 v2 整屋快照（容错路径用） */
function validV2SnapshotJson(): string {
  return JSON.stringify({
    version: 2,
    root: {
      id: 'h1',
      type: 'house',
      name: '示例房',
      dimensions: { length: 7, width: 4, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      layout: {
        mode: 'auto',
        template: 'corridor',
        corridor: { width: 1.2, entranceRoomId: 'living' },
      },
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

  it('双编码容错：模型把 JSON 对象包进 JSON 字符串时解包', () => {
    const wrapped = JSON.stringify({ version: 3, ops: [] })
    // wrapped 即 "{\"version\":3,\"ops\":[]}"（外层引号的字符串字面量）
    expect(extractModelJson(wrapped)).toBe('{"version":3,"ops":[]}')
    // 代码块内双编码同样解包
    expect(extractModelJson(`\`\`\`json\n${wrapped}\n\`\`\``)).toBe('{"version":3,"ops":[]}')
  })

  it('首尾恰是引号的散文不误判为双编码', () => {
    expect(extractModelJson('"好的，方案如下 {"version":2} 结束"')).toBe('{"version":2}')
  })
})

describe('repairTruncatedJson（截断容错）', () => {
  it('完整 JSON 返回 null（无需修复）', () => {
    expect(repairTruncatedJson('{"a":1}')).toBeNull()
    expect(repairTruncatedJson('{"version":3,"ops":[]}')).toBeNull()
  })

  it('补全未闭合的括号（含嵌套对象/数组顺序）', () => {
    expect(repairTruncatedJson('{"version":3,"ops":[{"op":"macro","name":"corridor"')).toBe(
      '{"version":3,"ops":[{"op":"macro","name":"corridor"}]}',
    )
    // 截断在分隔符后：先剔除末尾逗号再补全
    expect(repairTruncatedJson('{"version":3,"ops":[{"op":"addRoom","id":"a"},')).toBe(
      '{"version":3,"ops":[{"op":"addRoom","id":"a"}]}',
    )
  })

  it('字符串内的括号不参与配对', () => {
    // 值字符串内的 { 不压栈：根对象已闭合 → 结构完整，无需修复
    expect(repairTruncatedJson('{"a":"{x"}')).toBeNull()
    // 根对象未闭合 → 正常补全
    expect(repairTruncatedJson('{"a":"{x"')).toBe('{"a":"{x"}')
    expect(repairTruncatedJson('{"a":["{x"]')).toBe('{"a":["{x"]}')
  })

  it('字符串未闭合无法安全修复，返回 null', () => {
    expect(repairTruncatedJson('{"a":"未闭合')).toBeNull()
    expect(repairTruncatedJson('{"a":"abc')).toBeNull()
  })

  it('括号失衡（多余闭合/错配）无法安全修复，返回 null', () => {
    expect(repairTruncatedJson('{"a":]')).toBeNull()
    expect(repairTruncatedJson('{"a":1}}')).toBeNull()
  })
})

describe('generateModelFromChat', () => {
  it('ops 响应经执行器解析后返回模型（macro 平铺出走廊）', async () => {
    respondWith(validOpsJson())
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    const rooms = result.model.root.levels[0].rooms
    expect(rooms.some((c) => c.name === '走廊')).toBe(true)
    expect(rooms.some((c) => c.name === '主卧')).toBe(true)
    // 家具经常理摆放仍存在（macro auto 批次触发 furnitureConventions）
    const bed = result.model.root.levels[0].rooms
      .flatMap((r) => r.furniture)
      .find((f) => f.id === 'bed')
    expect(bed).toBeDefined()
  })

  it('v2 整屋快照走容错路径（按 id diff 成 ops）', async () => {
    respondWith(validV2SnapshotJson())
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    const rooms = result.model.root.levels[0].rooms
    expect(rooms.some((c) => c.name === '走廊')).toBe(true)
    expect(rooms.some((c) => c.name === '客厅')).toBe(true)
  })

  it('多轮时发送当前场景摘要（房间与家具 id）', async () => {
    respondWith(validOpsJson())
    const current: SceneModel = {
      version: 3,
      root: {
        id: 'h1',
        type: 'house',
        name: '示例房',
        levels: [
          {
            id: 'level-h1',
            height: 2.8,
            rooms: [
              {
                id: 'living',
                type: 'room',
                name: '客厅',
                footprint: [
                  { x: -2, z: -1.5 },
                  { x: 2, z: -1.5 },
                  { x: 2, z: 1.5 },
                  { x: -2, z: 1.5 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [
                  {
                    id: 'sofa',
                    type: 'furniture',
                    name: '沙发',
                    dimensions: { length: 2, width: 0.9, height: 0.8 },
                    position: { x: 0, y: 0.4, z: 0 },
                  },
                ],
                nestedRooms: [],
              },
            ],
          },
        ],
      },
    }
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '客厅再大一点',
      currentScene: current,
    })
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
    // system + 摘要 + 用户输入
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    const summary = body.messages[1].content
    expect(summary).toContain('当前房屋状态')
    expect(summary).toContain('living 客厅')
    expect(summary).toContain('sofa 沙发')
  })

  it('请求体启用流式并包含系统提示、历史与思考模式', async () => {
    respondWith(validOpsJson())
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
    // 提示词已动词化：要求输出操作序列
    expect(body.messages[0].content).toContain('op')
    expect(body.messages[0].content).toContain('macro')
    expect(body.messages[0].content).toContain('addRoom')
    // 入户门可迁移：setHouse 支持 entranceRoomId / entranceDir
    expect(body.messages[0].content).toContain('entranceDir')
    expect(body.messages[0].content).toContain('entranceRoomId')
  })

  it('P3 双向同步：手动编辑日志随上下文注入（摘要 + 编辑日志 + 用户输入）', async () => {
    respondWith(validOpsJson())
    const current: SceneModel = {
      version: 3,
      root: {
        id: 'h1',
        type: 'house',
        name: '示例房',
        levels: [
          {
            id: 'level-h1',
            height: 2.8,
            rooms: [
              {
                id: 'living',
                type: 'room',
                name: '客厅',
                footprint: [
                  { x: -2, z: -1.5 },
                  { x: 2, z: -1.5 },
                  { x: 2, z: 1.5 },
                  { x: -2, z: 1.5 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [],
                nestedRooms: [],
              },
            ],
          },
        ],
      },
    }
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '把沙发挪到门口',
      currentScene: current,
      editOps: [
        {
          op: 'updateFurniture',
          roomId: 'living',
          id: 'sofa',
          patch: { position: { x: 1, y: 0.4, z: 0 } },
        },
        { op: 'setHouse', name: '新家' },
      ],
    })
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
    // system + 场景摘要 + 编辑日志 + 用户输入
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user'])
    const log = body.messages[2].content
    expect(log).toContain('手动编辑历史')
    expect(log).toContain('updateFurniture')
    expect(log).toContain('sofa')
    // 日志按时间顺序（先家具后整屋）
    expect(log.indexOf('sofa')).toBeLessThan(log.indexOf('setHouse'))
  })

  it('editOps 为空时不注入编辑日志消息', async () => {
    respondWith(validOpsJson())
    await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: 'x',
      editOps: [],
    })
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body.messages[1].content).not.toContain('手动编辑历史')
  })

  it('思考模式为 default 时不发送 thinking 字段', async () => {
    respondWith(validOpsJson())
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

  it('ops 中部分操作无效时逐条容错（有效的照常执行）', async () => {
    respondWith(
      JSON.stringify({
        ops: [
          { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
          { op: 'updateRoom', id: 'ghost', patch: { name: 'x' } },
          { op: 'addRoom', id: 'b', name: '房B' },
          { op: 'unknown', foo: 1 },
        ],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: 'x',
    })
    const rooms = result.model.root.levels[0].rooms.map((r) => r.id)
    // macro 生效、addRoom 生效、无效的 updateRoom/unknown 被跳过
    expect(rooms).toContain('a')
    expect(rooms).toContain('b')
  })

  it('macro.name 填了整屋名时按 params 推断布局类型（容错修复，复现用户反馈）', async () => {
    // 模型把整屋名「三室一厅一厨」填进 macro.name（应为 corridor），params.corridor 仍在
    respondWith(
      JSON.stringify({
        version: 3,
        ops: [
          {
            op: 'macro',
            name: '三室一厅一厨',
            params: {
              name: '三室一厅一厨',
              corridor: { width: 1.2, entranceRoomId: '客厅' },
              rooms: [
                { id: '客厅', name: '客厅', dimensions: { length: 5, width: 4, height: 2.8 }, side: 'left' },
                { id: '次卧', name: '次卧', dimensions: { length: 3.5, width: 3, height: 2.8 }, side: 'right' },
              ],
            },
          },
        ],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '三室一厅一厨，主卧带卫生间',
    })
    // 修复后按 corridor 平铺：整屋名保留、出现走廊与客厅
    expect(result.model.root.name).toBe('三室一厅一厨')
    expect(result.model.root.levels[0].rooms.some((r) => r.name === '走廊')).toBe(true)
    expect(result.model.root.levels[0].rooms.some((r) => r.name === '客厅')).toBe(true)
  })

  it('macro.name 缺省但 params 含 corridor 时也能推断布局类型', async () => {
    respondWith(
      JSON.stringify({
        ops: [
          {
            op: 'macro',
            params: {
              corridor: { width: 1.2 },
              rooms: [
                { id: 'a', name: '房A', dimensions: { length: 4, width: 3, height: 2.8 }, side: 'left' },
                { id: 'b', name: '房B', dimensions: { length: 4, width: 3, height: 2.8 }, side: 'right' },
              ],
            },
          },
        ],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '两室',
    })
    // 推断为 corridor 后正常平铺：出现走廊与两间房
    expect(result.model.root.levels[0].rooms.some((r) => r.name === '走廊')).toBe(true)
    expect(result.model.root.levels[0].rooms.some((r) => r.name === '房A')).toBe(true)
    expect(result.model.root.levels[0].rooms.some((r) => r.name === '房B')).toBe(true)
  })

  it('未找到 JSON 时抛出 no-json 错误', async () => {
    respondWith('抱歉，我无法完成')
    await expect(
      generateModelFromChat({ apiKey: 'sk', history: [], userInput: 'x' }),
    ).rejects.toMatchObject({ code: 'no-json' })
  })

  it('模型回复 JSON 被截断时自动补全闭合括号（截断容错）', async () => {
    // 模拟流式回复在网络/输出长度处被截断：去掉尾部闭合符
    respondWith(validOpsJson().slice(0, -2))
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    // 截断修复后照常执行 macro，与完整回复一致
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0].rooms.some((c) => c.name === '走廊')).toBe(true)
  })

  it('模型把 JSON 包进 JSON 字符串（双编码）时也能解析', async () => {
    respondWith(JSON.stringify(validOpsJson()))
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0].rooms.some((c) => c.name === '主卧')).toBe(true)
  })

  it('输出既非 ops 也非 v2/v3 时抛出 invalid-schema 错误', async () => {
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

describe('buildSceneSummary', () => {
  it('包含整屋与房间 id/名称/尺寸，嵌套缩进，家具带 id', () => {
    const scene = emptyScene('测试屋')
    const s = buildSceneSummary(scene)
    expect(s).toContain('[整屋] house1 测试屋')
    expect(s).toContain('当前房屋状态')
  })

  it('顶层房间输出邻接表（邻居-方位，与墙体同源判定）', () => {
    const scene: SceneModel = {
      version: 3,
      root: {
        id: 'h1',
        type: 'house',
        name: '示例房',
        levels: [
          {
            id: 'level-h1',
            height: 2.8,
            rooms: [
              {
                id: 'living',
                type: 'room',
                name: '客厅',
                footprint: [
                  { x: -2, z: -1.5 },
                  { x: 2, z: -1.5 },
                  { x: 2, z: 1.5 },
                  { x: -2, z: 1.5 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [],
                nestedRooms: [],
              },
              {
                id: 'bedroom',
                type: 'room',
                name: '主卧',
                footprint: [
                  { x: -2, z: 1.5 },
                  { x: 2, z: 1.5 },
                  { x: 2, z: 4.5 },
                  { x: -2, z: 4.5 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [],
                nestedRooms: [],
              },
              {
                id: 'kitchen',
                type: 'room',
                name: '厨房',
                footprint: [
                  { x: 2, z: -1.5 },
                  { x: 5, z: -1.5 },
                  { x: 5, z: 1.5 },
                  { x: 2, z: 1.5 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [],
                nestedRooms: [],
              },
            ],
          },
        ],
      },
    }
    const s = buildSceneSummary(scene)
    // 主卧在客厅北侧、厨房在客厅东侧；厨房与主卧仅点接触不算相邻
    expect(s).toContain('living 客厅')
    expect(s).toContain('（邻接：主卧-北、厨房-东）')
    expect(s).toContain('（邻接：客厅-南）')
    expect(s).toContain('（邻接：客厅-西）')
  })
})

describe('buildEditOpsLog', () => {
  it('逐条紧凑 JSON 输出手动编辑日志', () => {
    const log = buildEditOpsLog([
      {
        op: 'updateFurniture',
        roomId: 'r',
        id: 'sofa',
        patch: { position: { x: 1, y: 0.4, z: 0 } },
      },
      { op: 'setHouse', name: '新家' },
    ])
    expect(log).toContain('手动编辑历史')
    expect(log).toContain('"op":"updateFurniture"')
    expect(log).toContain('"op":"setHouse"')
    const lines = log.split('\n')
    expect(lines[1]).toMatch(/^- \{/)
    expect(lines[2]).toMatch(/^- \{/)
  })
})
