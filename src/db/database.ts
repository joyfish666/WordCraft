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
