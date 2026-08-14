import Dexie, { type Table } from 'dexie'

/** 本地项目库中的模型记录 */
export interface ProjectRecord {
  id?: number
  name: string
  /** 模型 JSON 字符串 */
  data: string
  createdAt: number
  updatedAt: number
}

export class WordCraftDatabase extends Dexie {
  projects!: Table<ProjectRecord, number>

  constructor() {
    super('wordcraft')
    this.version(1).stores({
      projects: '++id, name, updatedAt',
    })
  }
}

export const db = new WordCraftDatabase()

/** 列出所有项目（按更新时间倒序） */
export async function listProjects(): Promise<ProjectRecord[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray()
}

/** 按 id 读取单个项目；不存在返回 undefined */
export async function getProject(id: number): Promise<ProjectRecord | undefined> {
  return db.projects.get(id)
}

/** 新建项目，返回自增 id */
export async function saveProject(
  input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<number> {
  const now = Date.now()
  return db.projects.add({ ...input, createdAt: now, updatedAt: now })
}

/** 更新项目（名称 / 数据），自动刷新 updatedAt */
export async function updateProject(
  id: number,
  patch: Partial<Pick<ProjectRecord, 'name' | 'data'>>,
): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: Date.now() })
}

/** 删除项目 */
export async function deleteProject(id: number): Promise<void> {
  await db.projects.delete(id)
}

// ---------------------------------------------------------------------------
// 容错门面（safeProjectDb）
// ---------------------------------------------------------------------------
// IndexedDB 在隐私模式/旧浏览器/配额已满时不可用，裸 await 会产生未捕获的
// promise rejection 且用户无任何反馈。所有 UI 调用方应走本门面：
// 失败时返回可空结果 + 一次性警告（与 localStorage 侧 safeStorage 的降级哲学对齐）。

/** 项目库操作失败是否已提示（一次性警告，避免刷屏） */
let dbErrorWarned = false

function warnDbError(op: string, error: unknown): void {
  if (dbErrorWarned) return
  dbErrorWarned = true
  console.warn(
    `[wordcraft] IndexedDB 不可用或配额已满（${op}）：${
      error instanceof Error ? error.message : String(error)
    }，项目库功能将不可用`,
  )
}

/** 项目库容错门面：所有方法不抛异常，失败返回可空结果 */
export const safeProjectDb = {
  /** 列出所有项目；失败返回空数组 */
  async list(): Promise<ProjectRecord[]> {
    try {
      return await listProjects()
    } catch (error) {
      warnDbError('list', error)
      return []
    }
  },

  /** 按 id 读取；不存在或失败返回 undefined */
  async get(id: number): Promise<ProjectRecord | undefined> {
    try {
      return await getProject(id)
    } catch (error) {
      warnDbError('get', error)
      return undefined
    }
  },

  /** 新建项目；失败返回 undefined */
  async save(
    input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<number | undefined> {
    try {
      return await saveProject(input)
    } catch (error) {
      warnDbError('save', error)
      return undefined
    }
  },

  /** 更新项目；成功返回 true */
  async update(id: number, patch: Partial<Pick<ProjectRecord, 'name' | 'data'>>): Promise<boolean> {
    try {
      await updateProject(id, patch)
      return true
    } catch (error) {
      warnDbError('update', error)
      return false
    }
  },

  /** 删除项目；成功返回 true */
  async remove(id: number): Promise<boolean> {
    try {
      await deleteProject(id)
      return true
    } catch (error) {
      warnDbError('delete', error)
      return false
    }
  },
}
