import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteProject, getProject, listProjects, saveProject, updateProject } from './database'

beforeEach(async () => {
  await db.projects.clear()
})

describe('项目库数据层', () => {
  it('saveProject 创建项目并返回自增 id', async () => {
    const id = await saveProject({ name: '测试房', data: '{"version":1}' })
    expect(id).toBeGreaterThan(0)
    const rec = await getProject(id)
    expect(rec?.name).toBe('测试房')
    expect(rec?.data).toBe('{"version":1}')
  })

  it('listProjects 按更新时间倒序', async () => {
    const a = await saveProject({ name: 'A', data: '' })
    await new Promise((r) => setTimeout(r, 5))
    const b = await saveProject({ name: 'B', data: '' })
    const list = await listProjects()
    expect(list.map((p) => p.id)).toEqual([b, a])
  })

  it('updateProject 刷新数据与更新时间', async () => {
    const id = await saveProject({ name: 'A', data: 'v1' })
    await new Promise((r) => setTimeout(r, 5))
    await updateProject(id, { data: 'v2' })
    const rec = await getProject(id)
    expect(rec?.data).toBe('v2')
    expect(rec!.updatedAt).toBeGreaterThan(rec!.createdAt)
  })

  it('deleteProject 删除项目', async () => {
    const id = await saveProject({ name: 'A', data: '' })
    await deleteProject(id)
    expect(await getProject(id)).toBeUndefined()
    expect(await listProjects()).toHaveLength(0)
  })
})
