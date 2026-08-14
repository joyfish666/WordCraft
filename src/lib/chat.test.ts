import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatGenerationError,
  buildEditOpsLog,
  buildSceneSummary,
  buildSystemPrompt,
  extractModelJson,
  generateModelFromChat,
  repairLenientJson,
  repairTruncatedJson,
  tryParseModelJson,
} from './chat'
import { emptyScene } from './executor'
import { useSettingsStore } from '../store/useSettingsStore'
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
  // 语言显式设为中文：默认跟随系统（jsdom 为 en-US），测试断言基于中文提示词/摘要产出
  useSettingsStore.setState({ language: 'zh', languageFollowsSystem: false })
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

  it('提取纯 ops 数组（提示词允许直接输出数组）', () => {
    expect(extractModelJson('[{"op":"addRoom","id":"a"}]')).toBe('[{"op":"addRoom","id":"a"}]')
  })

  it('从夹杂散文的文本中提取 ops 数组（无独立对象的场景）', () => {
    const arrayOnly = '方案如下：[{"op":"addRoom","id":"a","name":"客厅"}] 完毕'
    // 数组内嵌对象时按首个 { 到末个 } 截取，得到首个 op 对象；纯数组直出路径已覆盖完整数组
    expect(extractModelJson(arrayOnly)).toBe('{"op":"addRoom","id":"a","name":"客厅"}')
  })

  it('markdown 代码块内是纯 ops 数组时同样提取', () => {
    expect(extractModelJson('```json\n[{"op":"addRoom","id":"a"}]\n```')).toBe(
      '[{"op":"addRoom","id":"a"}]',
    )
  })

  it('只有对象没有数组时不误入数组分支', () => {
    expect(extractModelJson('抱歉 {"a":1} 结束')).toBe('{"a":1}')
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

describe('tryParseModelJson（解析容错链）', () => {
  const valid = '{"version":3,"ops":[]}'

  it('原样可解析时直接返回（recovery: raw）', () => {
    expect(tryParseModelJson(valid)).toEqual({ value: { version: 3, ops: [] }, recovery: 'raw' })
  })

  it('截断缺闭合符 → 补全后解析（recovery: repair）', () => {
    const parsed = tryParseModelJson('{"version":3,"ops":[]')
    expect(parsed?.recovery).toBe('repair')
    expect(parsed?.value).toEqual({ version: 3, ops: [] })
  })

  it('双编码（转义引号）→ 还原后解析（recovery: unescape）', () => {
    const escaped = '{\\"version\\":3,\\"ops\\":[]}'
    const parsed = tryParseModelJson(escaped)
    expect(parsed?.recovery).toBe('unescape')
    expect(parsed?.value).toEqual({ version: 3, ops: [] })
  })

  it('双编码 + 截断 → 还原并补全后解析（recovery: unescape-repair）', () => {
    const parsed = tryParseModelJson('{\\"version\\":3,\\"ops\\":[{\\"op\\":\\"addRoom\\"')
    expect(parsed?.recovery).toBe('unescape-repair')
    expect(parsed?.value).toEqual({ version: 3, ops: [{ op: 'addRoom' }] })
  })

  it('尾部多余闭合符（模型多打 }）→ 宽松修复跳过（recovery: lenient）', () => {
    // 完整 JSON 后多打一个右括号：repairTruncatedJson 在空栈 pop 会拒绝，宽松修复跳过该闭合符
    const extra = valid + '}'
    const parsed = tryParseModelJson(extra)
    expect(parsed?.recovery).toBe('lenient')
    expect(parsed?.value).toEqual({ version: 3, ops: [] })
  })

  it('尾部截断残留（半截垃圾）→ 修剪后解析（recovery: trim）', () => {
    const junk = '{"version":3,"ops":[]}xxxxxx'
    const parsed = tryParseModelJson(junk)
    expect(parsed?.recovery).toBe('trim')
    expect(parsed?.value).toEqual({ version: 3, ops: [] })
  })

  it('错配闭合符（少 ] 多 }，用户反馈复现）→ 宽松修复后解析（recovery: lenient）', () => {
    // 用户日志尾部 `...}}]}]}}}`：合法结尾 `...}}]}]}}]}` 被写成「少 ] 多 }」——
    // repairTruncatedJson 遇错配拒绝，靠宽松修复跳过错配闭合符并补全
    const anomalous =
      '{"version":3,"ops":[{"op":"macro","name":"corridor","params":{"rooms":[{"id":"a","name":"A","dimensions":{"length":2,"width":2,"height":2.8},"furniture":[{"id":"f","name":"马桶","dimensions":{"length":0.6,"width":0.4,"height":0.7},"position":{"x":0,"y":0.35,"z":0}}]}]}}'
    const parsed = tryParseModelJson(anomalous + '}')
    expect(parsed?.recovery).toBe('lenient')
    expect(parsed?.value).toMatchObject({ version: 3, ops: [{ op: 'macro' }] })
  })

  it('无法恢复的畸形文本返回 null', () => {
    expect(tryParseModelJson('{"a":"未闭合')).toBeNull()
    expect(tryParseModelJson('{{{')).toBeNull()
    expect(tryParseModelJson('垃圾文本')).toBeNull()
  })

  it('尾部垃圾在修剪窗口内恢复（>窗口长度的垃圾放弃，返回 null）', () => {
    // 窗口内（≤256 字符尾部垃圾）：修剪恢复
    const junk200 = '{"version":3,"ops":[]}' + 'x'.repeat(200)
    const parsed = tryParseModelJson(junk200)
    expect(parsed?.recovery).toBe('trim')
    expect(parsed?.value).toEqual({ version: 3, ops: [] })
    // 窗口外（超长垃圾）：不逐位扫描，直接失败（坑 121：O(n²) 全量扫描会冻结主线程）
    const junk300 = '{"version":3,"ops":[]}' + 'x'.repeat(300)
    expect(tryParseModelJson(junk300)).toBeNull()
  })

  it('超长纯垃圾回复在有限时间内返回 null（trim 扫描有界，坑 121 回归）', () => {
    // 100KB 垃圾：修复链各步 O(n)，trim 只尝试末尾 256 个裁剪点——
    // 旧实现全长逐位 slice+parse 是 O(n²)，此测试会挂到超时
    const garbage = 'x'.repeat(100_000)
    const start = Date.now()
    expect(tryParseModelJson(garbage)).toBeNull()
    expect(Date.now() - start).toBeLessThan(5_000)
  })
})

describe('repairLenientJson（宽松括号修复，坑 94）', () => {
  it('错配闭合符（少 ] 多 }，用户"三室一厅一厨"报错形态）修复成功', () => {
    const valid = '{"version":3,"ops":[{"op":"macro"}]}'
    // 模型把 ops 数组的 ] 写成 } 并在收尾多打一个 }：`...}]}` → `...}}`
    const anomalous = '{"version":3,"ops":[{"op":"macro"}}'
    expect(repairLenientJson(anomalous)).toBe(valid)
  })

  it('多余闭合符被跳过（完整 JSON 后多打 }）', () => {
    expect(repairLenientJson('{"a":1}}')).toBe('{"a":1}')
  })

  it('缺闭合符照常补全（与 repairTruncatedJson 同效）', () => {
    expect(repairLenientJson('{"version":3,"ops":[{"op":"macro","name":"corridor"')).toBe(
      '{"version":3,"ops":[{"op":"macro","name":"corridor"}]}',
    )
    // 末尾逗号先剔除再补全
    expect(repairLenientJson('{"version":3,"ops":[{"op":"addRoom","id":"a"},')).toBe(
      '{"version":3,"ops":[{"op":"addRoom","id":"a"}]}',
    )
  })

  it('字符串未闭合无法修复，返回 null', () => {
    expect(repairLenientJson('{"a":"未闭合')).toBeNull()
  })

  it('字符串内的括号不参与配对', () => {
    expect(repairLenientJson('{"a":"{x"')).toBe('{"a":"{x"}')
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
    const rooms = result.model.root.levels[0]!.rooms
    expect(rooms.some((c) => c.name === '走廊')).toBe(true)
    expect(rooms.some((c) => c.name === '主卧')).toBe(true)
    // 家具经常理摆放仍存在（macro auto 批次触发 furnitureConventions）
    const bed = result.model.root.levels[0]!.rooms.flatMap((r) => r.furniture).find(
      (f) => f.id === 'bed',
    )
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
    const rooms = result.model.root.levels[0]!.rooms
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
    const summary = body.messages[1]!.content
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
    expect(body.messages[0]!.content).toContain('op')
    expect(body.messages[0]!.content).toContain('macro')
    expect(body.messages[0]!.content).toContain('addRoom')
    // 入户门可迁移：setHouse 支持 entranceRoomId / entranceDir
    expect(body.messages[0]!.content).toContain('entranceDir')
    expect(body.messages[0]!.content).toContain('entranceRoomId')
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
    const log = body.messages[2]!.content
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
    expect(body.messages[1]!.content).not.toContain('手动编辑历史')
  })

  /** 单房间场景（5×4 卧室，无家具）供增量批次测试 */
  function bedroomScene(): SceneModel {
    return {
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
                id: 'bedroom',
                type: 'room',
                name: '主卧',
                footprint: [
                  { x: -2.5, z: -2 },
                  { x: 2.5, z: -2 },
                  { x: 2.5, z: 2 },
                  { x: -2.5, z: 2 },
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
  }

  it('增量批次（纯 addFurniture）触发常理摆放贴墙、但不补全配套（坑 119 回归）', async () => {
    // 多轮修改：LLM 只输出 addFurniture（无 macro）——此前 furnitureConventions 按
    // 「批内有 auto macro」计算为 false，新家具只被约束进墙、不贴墙摆放（与执行器契约脱节）
    respondWith(
      JSON.stringify({
        version: 3,
        ops: [
          {
            op: 'addFurniture',
            roomId: 'bedroom',
            name: '双人床',
            dimensions: { length: 2, width: 1.5, height: 0.5 },
          },
        ],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '在主卧加一张双人床',
      currentScene: bedroomScene(),
    })
    const room = result.model.root.levels[0]!.rooms.find((r) => r.id === 'bedroom')!
    const bed = room.furniture.find((f) => f.name === '双人床')!
    // 床贴某面墙（内壁，墙厚 0.15）
    const minX = -2.5 + 0.15
    const maxX = 2.5 - 0.15
    const minZ = -2 + 0.15
    const maxZ = 2 - 0.15
    const flush =
      Math.abs(bed.position.x - (minX + bed.dimensions.length / 2)) < 1e-6 ||
      Math.abs(bed.position.x - (maxX - bed.dimensions.length / 2)) < 1e-6 ||
      Math.abs(bed.position.z - (minZ + bed.dimensions.width / 2)) < 1e-6 ||
      Math.abs(bed.position.z - (maxZ - bed.dimensions.width / 2)) < 1e-6
    expect(flush).toBe(true)
    // 增量批次不补全配套（furnitureComplete=false）：床不自动带出床头柜——
    // 否则用户删掉的配套件会在下一次任意 addFurniture 批次被重新补回
    expect(room.furniture.some((f) => f.name === '床头柜')).toBe(false)
  })

  it('整屋生成批次（macro auto）仍执行配套补全（furnitureComplete=true）', async () => {
    respondWith(validOpsJson())
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    const master = result.model.root.levels[0]!.rooms.find((r) => r.id === 'master')!
    // 主卧有床 → 补 2 个床头柜（整屋生成语义）
    expect(master.furniture.filter((f) => f.name === '床头柜')).toHaveLength(2)
  })

  it('英文界面空场景默认整屋名为英文（坑 124）', async () => {
    // LLM 只输出 addRoom（未给整屋名）：英文界面不应出现中文「未命名房屋」
    useSettingsStore.setState({ language: 'en' })
    respondWith(
      JSON.stringify({
        version: 3,
        ops: [{ op: 'addRoom', id: 'a', name: 'Living Room' }],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: 'a living room',
    })
    expect(result.model.root.name).toBe('Unnamed House')
    // 中文界面保持原默认名
    useSettingsStore.setState({ language: 'zh' })
    respondWith(
      JSON.stringify({
        version: 3,
        ops: [{ op: 'addRoom', id: 'a', name: '客厅' }],
      }),
    )
    const zhResult = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '一个客厅',
    })
    expect(zhResult.model.root.name).toBe('未命名房屋')
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
    const rooms = result.model.root.levels[0]!.rooms.map((r) => r.id)
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
                {
                  id: '客厅',
                  name: '客厅',
                  dimensions: { length: 5, width: 4, height: 2.8 },
                  side: 'left',
                },
                {
                  id: '次卧',
                  name: '次卧',
                  dimensions: { length: 3.5, width: 3, height: 2.8 },
                  side: 'right',
                },
              ],
            },
          },
        ],
      }),
    )
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '三室一厅一厨，一个公共卫生间',
    })
    // 修复后按 corridor 平铺：整屋名保留、出现走廊与客厅
    expect(result.model.root.name).toBe('三室一厅一厨')
    expect(result.model.root.levels[0]!.rooms.some((r) => r.name === '走廊')).toBe(true)
    expect(result.model.root.levels[0]!.rooms.some((r) => r.name === '客厅')).toBe(true)
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
                {
                  id: 'a',
                  name: '房A',
                  dimensions: { length: 4, width: 3, height: 2.8 },
                  side: 'left',
                },
                {
                  id: 'b',
                  name: '房B',
                  dimensions: { length: 4, width: 3, height: 2.8 },
                  side: 'right',
                },
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
    expect(result.model.root.levels[0]!.rooms.some((r) => r.name === '走廊')).toBe(true)
    expect(result.model.root.levels[0]!.rooms.some((r) => r.name === '房A')).toBe(true)
    expect(result.model.root.levels[0]!.rooms.some((r) => r.name === '房B')).toBe(true)
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
    expect(result.model.root.levels[0]!.rooms.some((c) => c.name === '走廊')).toBe(true)
  })

  it('模型把 JSON 包进 JSON 字符串（双编码）时也能解析', async () => {
    respondWith(JSON.stringify(validOpsJson()))
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0]!.rooms.some((c) => c.name === '主卧')).toBe(true)
  })

  it('三室一厅一厨：模型回复尾部多打闭合符也能解析（用户反馈"JSON 无法解析"）', async () => {
    // 复现用户报错形态：完整 ops 后多一个 `}`——repair 括号栈空栈 pop 拒绝修复，
    // 靠 tryParseModelJson 的尾部修剪兜底（坑 42 系列扩充）
    respondWith(validOpsJson() + '}')
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '三室一厅一厨，一个公共卫生间',
    })
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0]!.rooms.some((c) => c.name === '走廊')).toBe(true)
  })

  it('三室一厅一厨：错配闭合符（少 ] 多 }）也能解析（坑 94 复现用户反馈）', async () => {
    // 用户 debug 日志真实形态：合法结尾 `...}}]}]}}]}` 被模型写成 `...}}]}]}}}`（少 ] 多 }），
    // repairTruncatedJson 遇错配返回 null、尾部修剪无合法前缀——靠宽松修复跳过错配并补全
    const valid = validOpsJson()
    const anomalous = valid.slice(0, -2) + '}'
    respondWith(anomalous)
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '三室一厅一厨，一个公共卫生间',
    })
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0]!.rooms.some((c) => c.name === '走廊')).toBe(true)
  })

  it('双编码 + 截断（外层引号缺失 + 内层转义）也能解析', async () => {
    // 模型输出 "{\"version\":3,...（外层字符串的收尾引号被截断）→ unwrapJsonString 解不了，
    // 靠容错链的「还原双编码 + 补全闭合」兜底
    const wrapped = JSON.stringify(validOpsJson())
    respondWith(wrapped.slice(0, -1))
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
    expect(result.model.root.levels[0]!.rooms.some((c) => c.name === '主卧')).toBe(true)
  })

  it('尾部带截断残留（正常 JSON + 垃圾字符）也能解析', async () => {
    respondWith(validOpsJson() + 'xyz')
    const result = await generateModelFromChat({
      apiKey: 'sk-test',
      history: [],
      userInput: '设计一个带走廊的两居室',
    })
    expect(result.model.root.name).toBe('示例房')
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

describe('系统提示词中英一致性（坑 123）', () => {
  it('中英文提示词包含相同的操作白名单（14 种 op）', () => {
    const opNames = (s: string): Set<string> =>
      new Set([...s.matchAll(/\{"op":"([a-zA-Z]+)"/g)].map((m) => m[1]!))
    const zhOps = opNames(buildSystemPrompt('zh'))
    const enOps = opNames(buildSystemPrompt('en'))
    expect(enOps).toEqual(zhOps)
    expect(zhOps.size).toBe(14) // setHouse/macro/addRoom/updateRoom/removeRoom/moveRoom/nestRoom/splitRoom/mergeRoom/addFurniture/updateFurniture/removeFurniture/setOpenings/addAdjacency
  })

  it('中英文提示词规则序号一致（新增/删改规则时双份必须同步）', () => {
    const ruleNums = (s: string): Set<string> =>
      new Set([...s.matchAll(/^\s*(\d+)\./gm)].map((m) => m[1]!))
    expect(ruleNums(buildSystemPrompt('en'))).toEqual(ruleNums(buildSystemPrompt('zh')))
  })
})
