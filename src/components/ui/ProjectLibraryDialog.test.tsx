import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleModel } from '../../lib/sampleModel'
import { useModelStore } from '../../store/useModelStore'
import { useProjectStore } from '../../store/useProjectStore'
import { ProjectLibraryDialog } from './ProjectLibraryDialog'

// mock 数据层：对话框只调用这些函数，行为由测试控制
const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  saveProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
}))

vi.mock('../../db/database', () => ({
  listProjects: mocks.listProjects,
  saveProject: mocks.saveProject,
  updateProject: mocks.updateProject,
  deleteProject: mocks.deleteProject,
  getProject: mocks.getProject,
}))

function renderDialog(overrides: Partial<{ open: boolean }> = {}) {
  const onClose = vi.fn()
  const onOpenProject = vi.fn()
  const onProjectCreated = vi.fn()
  render(
    <ProjectLibraryDialog
      open={overrides.open ?? true}
      onClose={onClose}
      onOpenProject={onOpenProject}
      onProjectCreated={onProjectCreated}
    />,
  )
  return { onClose, onOpenProject, onProjectCreated }
}

beforeEach(() => {
  localStorage.clear()
  useModelStore.setState({ scene: null, selectedId: null })
  useProjectStore.setState({ currentId: null, currentName: null, dirty: false })
  mocks.listProjects.mockResolvedValue([])
  mocks.saveProject.mockReset()
  mocks.updateProject.mockReset()
  mocks.deleteProject.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProjectLibraryDialog', () => {
  it('打开时显示新建区与空列表提示', async () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: '本地项目库' })).toBeInTheDocument()
    expect(await screen.findByText(/暂无项目/)).toBeInTheDocument()
  })

  it('列表显示项目行，点击打开触发 onOpenProject', async () => {
    mocks.listProjects.mockResolvedValue([
      { id: 5, name: '我的房子', data: '{"version":1}', createdAt: 1, updatedAt: 2 },
    ])
    const { onOpenProject } = renderDialog()
    expect(await screen.findByText('我的房子')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(onOpenProject).toHaveBeenCalledWith(5, '我的房子')
  })

  it('新建项目：saveProject 并触发 onProjectCreated', async () => {
    const scene = createSampleModel()
    useModelStore.setState({ scene })
    mocks.saveProject.mockResolvedValue(9)
    const { onProjectCreated } = renderDialog()
    fireEvent.change(screen.getByPlaceholderText('项目名称'), { target: { value: '新方案' } })
    fireEvent.click(screen.getByRole('button', { name: '保存当前场景' }))
    expect(mocks.saveProject).toHaveBeenCalledWith({
      name: '新方案',
      data: JSON.stringify(scene),
    })
    await vi.waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(9, '新方案'))
  })

  it('重命名提交 updateProject', async () => {
    mocks.listProjects.mockResolvedValue([
      { id: 5, name: '旧名', data: '{}', createdAt: 1, updatedAt: 2 },
    ])
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '重命名' }))
    const input = screen.getByDisplayValue('旧名')
    fireEvent.change(input, { target: { value: '新名' } })
    fireEvent.blur(input)
    await vi.waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith(5, { name: '新名' }))
  })

  it('删除项目：确认后调用 deleteProject', async () => {
    mocks.listProjects.mockResolvedValue([
      { id: 5, name: '旧名', data: '{}', createdAt: 1, updatedAt: 2 },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await vi.waitFor(() => expect(mocks.deleteProject).toHaveBeenCalledWith(5))
  })

  it('项目行显示房间数（v3 模型：root.levels[0].rooms，原实现读错字段恒为 0）', async () => {
    const model = createSampleModel()
    const rooms = model.root.levels[0].rooms.map((r) => ({ ...r }))
    mocks.listProjects.mockResolvedValue([
      { id: 1, name: '三房', data: JSON.stringify(model), createdAt: 1, updatedAt: 2 },
      {
        id: 2,
        name: '空场景',
        data: JSON.stringify({ version: 3, root: { type: 'house', levels: [{ rooms: [] }] } }),
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    renderDialog()
    expect(await screen.findByText(`本地项目库`)).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(screen.getByText(new RegExp(`${rooms.length} 个房间`))).toBeInTheDocument()
      expect(screen.getByText(/0 个房间/)).toBeInTheDocument()
    })
  })
})
