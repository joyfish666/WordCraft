import { t } from '../i18n'
import { sceneModelV2Schema } from '../schemas/model.schema'
import { opSchema } from '../schemas/ops.schema'
import { logDebug } from './debugLog'
import { diffSceneV2, emptyScene, executeOps } from './executor'
import { footprintCenter, roomDims } from './footprint'
import { normalizeContainment } from './modelTree'
import { migrateModel } from './migration'
import type { SceneModel } from '../types/model'
import type { Op } from '../types/ops'
import { streamChatCompletion, type ApiClientOptions, type ChatMessage } from './api'

/** 生成链路中的业务错误，code 供 UI 层区分处理 */
export class ChatGenerationError extends Error {
  constructor(
    message: string,
    public code: 'no-json' | 'invalid-schema' | 'http',
  ) {
    super(message)
    this.name = 'ChatGenerationError'
  }
}

/**
 * 指导大模型输出 v3 操作序列（ops）的系统提示词（design.md §4.3）：
 * 从"输出整屋 JSON 快照"改为"输出增量操作"——局部修改不重写整屋；
 * 没有固定模板，macro 仅在用户不关心布局时使用。
 */
export function buildSystemPrompt(): string {
  return `你是一个 3D 空间结构建模助手。用户会用自然语言描述空间、房屋、房间与家具的布局需求。
你通过输出「操作序列」（JSON）来构建或修改 3D 模型，严格遵守以下规则：

1. 只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码块。格式：{"version":3,"ops":[...]}（也可直接输出 ops 数组）。一切以用户明确要求为主，用户未明确时才按常理推断，不擅自改变用户已指定的内容。
2. 没有固定模板：用户怎么描述就怎么设计，不要套用固定布局。只有当用户不关心具体布局、或要求整体重新规划时，才用 macro（macro 会清空并重建整屋布局）。
3. 操作白名单（未列出的字段不要输出；所有可选字段可按需省略）：
   - {"op":"setHouse","name":"新名字"} —— 修改整屋名称（name/style 可选）；{"op":"setHouse","entranceRoomId":"房间id","entranceDir":"south|east|west|north"} —— 改入户门所在的房间与方向（默认 south 南墙，见规则 7）
   - {"op":"macro","name":"corridor|living|custom","params":{...}} —— 整体布局，params.rooms 为房间规格数组（语义见 addRoom）：
     · corridor（走廊型，常规多房间住宅）：params={"name":"整屋名","corridor":{"width":1.2,"entranceRoomId":"客厅id"},"rooms":[...]}
       走廊沿东西向（X 轴）贯穿；入口房间自动置于走廊南侧并生成入户大门；每个房间规格填 "side":"left"（南侧）或 "right"（北侧），children 顺序即沿走廊从入户端向内的排列；两侧尽量均衡分布。
     · living（客厅居中/厅堂式）：params={"name":"整屋名","centerRoomId":"客厅id","rooms":[...]}，其他房间规格填 "side":"north"|"south"|"east"|"west"（相对客厅）
     · custom（自由布局）：params={"name":"整屋名","rooms":[...]}，房间可用 "position"（绝对坐标，y 为层高一半）或 "footprint"（正交多边形顶点环，L 形/U 形直接表达）指定位置
   - {"op":"addRoom","id":"可选","name":"房间名","dimensions":{"length","width","height"},"relativeTo":{"roomId":"已有房间id","dir":"north|south|east|west"},"side":"可选","furniture":[家具规格...],"nestedRooms":[房间规格...]}
     · relativeTo：新房间贴到指定房间的 dir 一侧（无缝共墙）。**新增房间尽量提供 relativeTo**；不提供时执行器排到整屋东侧。
   - {"op":"updateRoom","id":"房间id","patch":{"name":...,"dimensions":{...},"footprint":[...]}} —— 修改名称/尺寸/足迹；未提及的字段保持不变
   - {"op":"removeRoom","id":"房间id"}
   - {"op":"moveRoom","id":"房间id","relativeTo":{"roomId":...,"dir":...}} —— 把房间移到另一个房间的 dir 侧相邻（相对位置调整用它）；**嵌套房间（如主卧卫生间）用它会自动移出父房间、取消内嵌**；若该侧被其他房间/走廊占用，会自动选其他空侧贴靠
   - {"op":"nestRoom","id":"房间id","into":"父房间id","side":"可选(north|south|east|west)"} —— 把房间**内嵌**到另一个房间内部成为其嵌套子房间（如"主卧卫生间"内嵌进"主卧"：{"op":"nestRoom","id":"主卧卫生间","into":"主卧"}）；side 决定靠父房间哪个角（默认东北角），嵌套房间朝父房间内部开门。**取消内嵌/把嵌套房间移出来 → 用 moveRoom，不要用 nestRoom**
   - {"op":"addFurniture","roomId":"房间id","id":"可选","name":"家具名","dimensions":{"length","width","height"},"position":{"x","y","z"}}
   - {"op":"updateFurniture","roomId":...,"id":...,"patch":{"name":...,"dimensions":{...},"position":{...}}}
   - {"op":"removeFurniture","roomId":...,"id":...}
    - {"op":"setOpenings","roomId":...,"side":"north|south|east|west","kind":"door|window","from":"可选","to":"可选","remove":"可选(true)"} —— 在房间某面墙开洞；不填 from/to 时居中开标准大小（门 0.9m、窗 1.5m）；**"remove":true 删除该边同种开洞**（用户要求去掉门/窗时用）
    - {"op":"splitRoom","id":"房间id","axis":"x|z","position":"世界坐标","name":"可选新房间名"} —— 把**矩形**房间沿轴线切成两间（axis x=竖切、z=横切；position 为世界坐标，两侧需各 ≥ 1m），共墙自动开一扇门；拆出来的新房间默认叫「原名2」
    - {"op":"mergeRoom","keep":"保留的房间id","remove":"被合并的房间id"} —— 合并两个相邻房间（并集必须是矩形），keep 保留名称与 id
    - {"op":"addAdjacency","roomId":...,"neighborId":...,"side":"..."} —— 把 neighborId 房间移到 roomId 的 side 侧相邻
4. id 规则：所有节点 id 全局唯一；**修改已有对象时必须复用其 id**（见「当前房屋状态」）；多轮对话中保持已有 id 不变，不要删除无关对象。修改布局意图时优先用 moveRoom/addRoom（带 relativeTo）局部调整；只有整体重排才用 macro。
5. 尺寸约定（单位：米）：length 为东西向，width 为南北向，height 为层高（默认 2.8）。相邻房间的墙应贴合（间隙为 0）。
6. 家具：**每个房间必须包含该房间常见且合理的家具，不要留空房间**——客厅：沙发/茶几/电视柜；卧室：床/衣柜（主卧再加床头柜等）；餐厅：餐桌/餐椅；厨房：橱柜/冰箱/灶台；卫生间：马桶/洗手池等（每类至少配 1-2 件）。家具 position 相对所在房间中心：x/z 为相对中心偏移，y 为家具高度的一半（底面贴房间地面）。摆放应合理（床靠墙、衣柜贴墙、桌椅避开通道、中间留活动空间），只以所在房间为框架考虑、无需考虑整屋布局；家具不得超出房间范围、不得嵌入墙体、不得堵住门洞。
7. 惯例与墙体：客厅/餐厅/厨房为开放空间，与走廊之间不设墙（开放连通）；卧室/书房/卫生间等保留墙体与门；卧室与卧室之间不直接开门（经走廊/卫生间连通）；**卫生间默认只开一扇门**（命名归属的如"主卧卫生间"朝所属房间开门；公共/普通卫生间朝走廊开门，不向相邻房间开门）——用户要求卫生间开第二扇门时才用 setOpenings 添加。房屋外墙由系统自动保留（除入户门外不与外部相通），入户大门自动生成在**入口房间**（entranceRoomId）的**入口方向外墙**（entranceDir 指定，默认 south 南墙）居中合理位置——用户要求移动入户门/改朝向时，用 setHouse 的 entranceRoomId（换房间）与 entranceDir（换方向，south/east/west/north），**不要用 setOpenings**（它只能在已有实心墙上开洞，移动不了入户门；开在开放/共享墙上没有效果）；入户门必须落在入口房间朝向入口方向的外墙（走廊等内部空间没有外墙时，选它最外沿的方向，如走廊东端用 east）。custom 布局除户外门会自动兜底。
8. 多轮修改：最新一条用户消息是对当前房屋的修改要求。你必须基于「当前房屋状态」与「手动编辑历史」（若有）修改：只输出必要的操作，未提及的对象不要重复输出、不要无意义地删除重建（会丢失用户改动）；手动编辑历史中的操作已是现状，不要原样重复输出。"卫生间移到卧室北部" → moveRoom {"id":"卫生间id","relativeTo":{"roomId":"卧室id","dir":"north"}}；"客厅再大一点" → updateRoom 改 dimensions。
9. 合理推断默认尺寸；用户未明确时可补充常见家具尺寸（如双人床约 2×1.5m、衣柜约 1.2×0.6m、沙发约 2×0.9m）。`
}

/**
 * 当前房屋状态摘要（供多轮对话上下文，design.md §5.2）：
 * 房间/家具的 id、名称与尺寸 + 顶层房间**邻接表**（邻居与方位）——LLM 靠 id 引用节点、
 * 靠邻接信息判断方位（relativeTo/moveRoom 的 dir 选择）。邻接判定与墙体方案同源：
 * 任一边共线（|线差| ≤ 0.4，同 ADJACENCY_GAP）且区间重叠即相邻，方位 = 邻居相对本房间的方向。
 */
export function buildSceneSummary(scene: SceneModel): string {
  const rooms = scene.root.levels[0].rooms
  const adjacency = topLevelAdjacency(rooms)
  const lines: string[] = ['当前房屋状态（id: 名称 长×宽×高，米；房间行括号内为邻接房间-方位）：']
  const visit = (room: SceneModel['root']['levels'][0]['rooms'][number], depth: number): void => {
    const d = roomDims(room)
    lines.push(
      `${'  '.repeat(depth + 1)}- ${room.id} ${room.name} ${fmt(d.length)}×${fmt(d.width)}×${fmt(d.height)}${adjacency.get(room.id) ?? ''}`,
    )
    if (room.furniture.length > 0) {
      lines.push(
        ...room.furniture.map(
          (f) =>
            `${'  '.repeat(depth + 2)}· ${f.id} ${f.name} ${fmt(f.dimensions.length)}×${fmt(f.dimensions.width)}×${fmt(f.dimensions.height)}`,
        ),
      )
    }
    for (const nested of room.nestedRooms) visit(nested, depth + 1)
  }
  lines.push(`[整屋] ${scene.root.id} ${scene.root.name}`)
  for (const room of rooms) visit(room, 0)
  return lines.join('\n')
}

/** 顶层房间邻接表：roomId → 「（邻接：邻居名-方位、…）」，无邻居的房间无条目 */
function topLevelAdjacency(rooms: SceneModel['root']['levels'][0]['rooms']): Map<string, string> {
  interface Edge {
    axis: 'x' | 'z'
    line: number
    a: number
    b: number
  }
  const edgesOf = (r: SceneModel['root']['levels'][0]['rooms'][number]): Edge[] => {
    const fp = r.footprint
    const out: Edge[] = []
    for (let i = 0; i < fp.length; i++) {
      const p = fp[i]
      const q = fp[(i + 1) % fp.length]
      if (Math.abs(p.z - q.z) < 1e-6) {
        out.push({ axis: 'x', line: p.z, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) })
      } else {
        out.push({ axis: 'z', line: p.x, a: Math.min(p.z, q.z), b: Math.max(p.z, q.z) })
      }
    }
    return out
  }
  const edgeMap = new Map(rooms.map((r) => [r.id, edgesOf(r)]))
  const center = new Map(rooms.map((r) => [r.id, footprintCenter(r.footprint)]))
  const list = new Map<string, string[]>()
  const GAP = 0.4
  const dirOf = (axis: 'x' | 'z', from: string, to: string): string => {
    const cFrom = center.get(from)!
    const cTo = center.get(to)!
    if (axis === 'x') return cTo.z > cFrom.z ? '北' : '南'
    return cTo.x > cFrom.x ? '东' : '西'
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i]
      const B = rooms[j]
      const shared = edgeMap
        .get(A.id)!
        .find((e1) =>
          edgeMap
            .get(B.id)!
            .some(
              (e2) =>
                e1.axis === e2.axis &&
                Math.abs(e1.line - e2.line) <= GAP &&
                e1.a < e2.b - 1e-6 &&
                e1.b > e2.a + 1e-6,
            ),
        )
      if (!shared) continue
      list.set(A.id, [...(list.get(A.id) ?? []), `${B.name}-${dirOf(shared.axis, A.id, B.id)}`])
      list.set(B.id, [...(list.get(B.id) ?? []), `${A.name}-${dirOf(shared.axis, B.id, A.id)}`])
    }
  }
  return new Map(
    [...list.entries()].map(([id, texts]) => [id, `（邻接：${texts.join('、')}）`]),
  )
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/**
 * 手动编辑操作日志（design.md §5.2 上下文改造）：
 * 与场景摘要一起作为多轮上下文注入——摘要表达"当前是什么"（房间/家具 id·名称·尺寸），
 * 日志表达"用户刚改了什么"（与对话 op 同构的增量操作，按时间顺序）。
 * 逐条紧凑 JSON 输出；操作种类有限（setHouse/updateRoom/updateFurniture），token 开销小。
 */
export function buildEditOpsLog(ops: Op[]): string {
  const lines = ['手动编辑历史（用户在当前房屋上手动做过的修改，按时间顺序，引用 id 与上面一致）：']
  for (const op of ops) {
    lines.push(`- ${JSON.stringify(op)}`)
  }
  return lines.join('\n')
}

/**
 * 从模型回复中提取 JSON 字符串：支持纯 JSON、markdown 代码块、夹杂散文、双编码四种情况。
 * 双编码容错：模型偶发把 JSON 对象包进 JSON 字符串（内容以引号包裹），解包一层。
 */
export function extractModelJson(text: string): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) return trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) {
    const extracted = fence[1].trim()
    // 代码块内也可能是双编码（字符串字面量），解包失败则用原文
    return unwrapJsonString(extracted) ?? extracted
  }
  // 双编码容错：整段文本本身是一个包裹着 JSON 的字符串字面量
  const unwrapped = unwrapJsonString(trimmed)
  if (unwrapped !== null) return unwrapped
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1)
  return null
}

/** 若文本是包裹着 JSON 的字符串字面量（外层引号，如 "{\"a\":1}"），解包返回内层 JSON；否则返回 null */
function unwrapJsonString(text: string): string | null {
  if (!text.startsWith('"') || !text.endsWith('"')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === 'string') {
      const inner = parsed.trim()
      if (inner.startsWith('{') || inner.startsWith('[')) return inner
    }
  } catch {
    // 不是合法 JSON 字符串（如散文首尾恰好是引号），不视为双编码
  }
  return null
}

/**
 * 截断容错：模型流式回复偶发被截断（网络中断/输出长度上限），整段 JSON 末尾缺少闭合符。
 * 若文本是"未闭合括号"的合法前缀（字符串均已闭合、括号匹配无误），按括号栈补全缺失的
 * 闭合符后返回；字符串未闭合 / 括号失衡 / 本就完整时返回 null（无法安全修复）。
 * 注意：补全后仍可能因缺逗号等语法错误无法解析（如 {"a":1,），调用方需再次 try。
 */
export function repairTruncatedJson(text: string): string | null {
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      const expected = ch === '}' ? '{' : '['
      if (stack.length === 0 || stack[stack.length - 1] !== expected) return null
      stack.pop()
    }
  }
  if (inString || stack.length === 0) return null
  // 截断点恰在分隔符后时（如 "...a", 或 "...a" ,），末尾逗号会阻塞补全，先剔除尾部空白与逗号
  let end = text.length
  while (end > 0) {
    const ch = text[end - 1]
    if (ch !== ',' && !/\s/.test(ch)) break
    end--
  }
  if (end < text.length) text = text.slice(0, end)
  // 按反序补全：先闭合最内层（栈顶），再逐层向外
  const closers = stack
    .map((c) => (c === '{' ? '}' : ']'))
    .reverse()
    .join('')
  return text + closers
}

export interface GenerateResult {
  /** 模型原始回复 */
  reply: string
  /** 通过校验并解析为绝对坐标的模型 */
  model: SceneModel
}

export interface GenerateOptions extends ApiClientOptions {
  history: ChatMessage[]
  userInput: string
  /** 当前场景（多轮上下文摘要的来源；缺省时从空场景开始） */
  currentScene?: SceneModel | null
  /** P3 双向同步：用户手动编辑的操作日志（与对话 op 同构），注入上下文让 LLM 看到手动改动 */
  editOps?: Op[]
  /** 流式返回时逐段回调（用于展示进度） */
  onChunk?: (delta: string) => void
}

/** 生成请求的整体兜底超时（流式连接自身保持活跃，此超时仅防挂死） */
const GENERATION_TIMEOUT_MS = 180_000

/**
 * 调用大模型生成模型：系统提示 + 多轮历史 + 场景摘要 + 用户输入 → 流式接收 → 解析为操作序列
 * → 确定性执行器逐条应用（快照输出走 diff 容错路径）。使用 SSE 流式请求，兼容推理型模型。
 * 发送前不进行有效性检测，由调用方确保已配置 API Key。
 */
export async function generateModelFromChat(options: GenerateOptions): Promise<GenerateResult> {
  const { history, userInput, currentScene, editOps, onChunk, ...clientOptions } = options
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt() }, ...history]
  // 多轮上下文：当前房屋状态摘要（含 id），LLM 靠 id 引用已有节点
  if (currentScene) {
    messages.push({ role: 'user', content: buildSceneSummary(currentScene) })
  }
  // P3 双向同步：用户手动编辑的操作日志（摘要表达"当前是什么"，日志表达"用户刚改了什么"）
  if (editOps && editOps.length > 0) {
    messages.push({ role: 'user', content: buildEditOpsLog(editOps) })
  }
  messages.push({ role: 'user', content: userInput })

  logDebug('发送请求', {
    model: clientOptions.model ?? '(默认)',
    baseUrl: clientOptions.baseUrl ?? '(默认)',
    messagesCount: messages.length,
    hasCurrentScene: !!currentScene,
    editOpsCount: editOps?.length ?? 0,
    lastUser: userInput,
  })

  let content: string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)
  try {
    content = await streamChatCompletion(clientOptions, messages, onChunk, controller.signal)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logDebug('模型请求失败', detail, 'error')
    throw new ChatGenerationError(t('error.httpRequestFailed', { detail }), 'http')
  } finally {
    clearTimeout(timer)
  }

  logDebug('收到模型原始回复', content, 'info')

  const json = extractModelJson(content)
  if (!json) {
    throw new ChatGenerationError(t('error.noJson'), 'no-json')
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    // 截断容错：模型流式回复偶发被截断（网络中断/输出长度上限），按未闭合括号补全后再解析
    const repaired = repairTruncatedJson(json)
    if (repaired === null) {
      throw new ChatGenerationError(t('error.invalidJson'), 'invalid-schema')
    }
    logDebug('模型回复 JSON 被截断，已自动补全闭合括号', repaired, 'warn')
    try {
      raw = JSON.parse(repaired)
    } catch {
      throw new ChatGenerationError(t('error.invalidJson'), 'invalid-schema')
    }
  }

  // 原始回复本身就是纯净 JSON 时，解析结果与之相同——跳过重复的大段 JSON，避免日志翻倍
  if (json.trim() !== content.trim()) {
    logDebug('模型回复 JSON 解析结果', raw, 'info')
  }

  const model = resolveRawOutput(raw, currentScene ?? null)
  return { reply: content, model }
}

/**
 * 将模型原始输出解析为 v3 场景（design.md §4.2 三级容错）：
 * 1. 操作序列（ops）：白名单校验，逐条容错执行；
 * 2. 旧式整屋快照（v2）：按 id diff 成 ops 再执行（快照容错路径）；
 * 3. 已是 v3 场景：直接使用（迁移幂等），normalize 兜底。
 */
function resolveRawOutput(raw: unknown, currentScene: SceneModel | null): SceneModel {
  const base = currentScene ?? emptyScene()

  // 路径 1：操作序列（逐条容错：单条无效只跳过该条，其余照常执行）
  const ops = parseOps(raw)
  if (ops.length > 0) {
    logDebug('ops 操作序列解析通过', {
      count: ops.length,
      kinds: ops.map((o) => o.op),
    })
    const furnitureConventions = ops.some((o) => o.op === 'macro' && o.name !== 'custom')
    const result = executeOps(base, ops, { furnitureConventions })
    if (result.skipped.length > 0) {
      logDebug('部分操作失败已跳过', result.skipped, 'warn')
    }
    return result.scene
  }

  // 路径 2：旧式整屋快照（v2）→ 按 id diff 成 ops
  const v2 = sceneModelV2Schema.safeParse(raw)
  if (v2.success) {
    logDebug('v2 整屋快照容错路径：按 id diff 成 ops', {
      rooms: v2.data.root.children.map((r) => r.id),
    })
    const ops2 = diffSceneV2(base, v2.data)
    const result = executeOps(base, ops2, { furnitureConventions: true })
    return result.scene
  }

  // 路径 3：已是 v3 场景（迁移幂等，原样返回）
  const v3 = migrateModel(raw)
  if (v3) {
    logDebug('v3 场景直接使用', { house: v3.root.name })
    return normalizeContainment(v3)
  }

  const issues = describeSchemaIssues(raw)
  logDebug('模型输出无法解析', issues, 'error')
  throw new ChatGenerationError(t('error.invalidSchema', { issues }), 'invalid-schema')
}

/** 解析模型输出为操作序列：{"version":3,"ops":[...]} 或直接数组；逐条容错，一条无效不影响其余 */
function parseOps(raw: unknown): Op[] {
  if (typeof raw !== 'object' || raw === null) return []
  const array: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { ops?: unknown }).ops)
      ? (raw as { ops: unknown[] }).ops
      : []
  if (array.length === 0) return []
  const ops: Op[] = []
  for (const item of array) {
    const parsed = opSchema.safeParse(item)
    if (parsed.success) ops.push(parsed.data)
    else {
      logDebug(
        '单条 op 无效已跳过',
        {
          op: item,
          reason: parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        'warn',
      )
    }
  }
  return ops
}

function describeSchemaIssues(raw: unknown): string {
  // 带 ops 数组（含空/全部无效）→ 已确认是 ops 输出，只是没解析出可用操作
  const hasOps =
    (typeof raw === 'object' && raw !== null && Array.isArray((raw as { ops?: unknown }).ops)) ||
    Array.isArray(raw)
  if (hasOps) return 'ops 为空或全部无效'
  const v2 = sceneModelV2Schema.safeParse(raw)
  if (!v2.success) {
    const issues = v2.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('；')
    return issues
  }
  return '未知格式'
}
