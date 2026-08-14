import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testConnection } from '../lib/api'
import { useSettingsStore } from '../store/useSettingsStore'
import { SettingsPage } from './SettingsPage'

/**
 * SettingsPage 单元测试（jsdom 可渲染，无 WebGL 依赖）：
 * API Key 增删/radio 激活切换/默认 Base URL 与模型输入/连通性检测（mock testConnection
 * 成功与失败文案）/语言切换。runTest 是异步路径（aliveRef 守卫），断言用 findBy*。
 */

vi.mock('../lib/api', () => ({
  testConnection: vi.fn(),
}))

const mockTestConnection = vi.mocked(testConnection)

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({
    apiKeys: [],
    activeKeyId: null,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    thinking: 'disabled',
    colorMode: 'standard',
    wireframe: { enabled: false, lineWidth: 1 },
    shadows: true,
    debugMode: false,
    language: 'zh',
    languageFollowsSystem: true,
  })
  mockTestConnection.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('SettingsPage', () => {
  it('添加 API Key：表单提交 → store 增条目 + 首条自动激活 + 表单清空', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('名称，如 DeepSeek 主账号'), {
      target: { value: '我的 Key' },
    })
    fireEvent.change(screen.getByPlaceholderText('API Key'), {
      target: { value: 'sk-test-123' },
    })
    fireEvent.click(screen.getByText('添加'))
    const s = useSettingsStore.getState()
    expect(s.apiKeys).toHaveLength(1)
    expect(s.apiKeys[0]).toMatchObject({ name: '我的 Key', key: 'sk-test-123' })
    // 首条自动激活 + 列表展示「当前」标签与掩码 Key（maskKey：sk-test-123 → sk-…-123）
    expect(s.activeKeyId).toBe(s.apiKeys[0]!.id)
    expect(screen.getByText('当前')).toBeInTheDocument()
    expect(screen.getByText(/sk-…-123/)).toBeInTheDocument()
    // 表单已清空
    expect(screen.getByPlaceholderText('名称，如 DeepSeek 主账号')).toHaveValue('')
    expect(screen.getByPlaceholderText('API Key')).toHaveValue('')
  })

  it('名称或 Key 为空时添加按钮禁用（不产生条目）', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('名称，如 DeepSeek 主账号'), {
      target: { value: '只有名字' },
    })
    const addButton = screen.getByText('添加') as HTMLButtonElement
    expect(addButton.disabled).toBe(true)
    fireEvent.click(addButton)
    expect(useSettingsStore.getState().apiKeys).toHaveLength(0)
  })

  it('删除 API Key：store 移除条目，激活项回退到剩余项', () => {
    useSettingsStore.setState({
      apiKeys: [
        { id: 'k1', name: 'A', key: 'key-a', createdAt: 0 },
        { id: 'k2', name: 'B', key: 'key-b', createdAt: 1 },
      ],
      activeKeyId: 'k1',
    })
    renderPage()
    fireEvent.click(screen.getAllByText('删除')[0]!)
    const s = useSettingsStore.getState()
    expect(s.apiKeys.map((k) => k.id)).toEqual(['k2'])
    expect(s.activeKeyId).toBe('k2')
  })

  it('radio 切换激活 Key', () => {
    useSettingsStore.setState({
      apiKeys: [
        { id: 'k1', name: 'A', key: 'key-a', createdAt: 0 },
        { id: 'k2', name: 'B', key: 'key-b', createdAt: 1 },
      ],
      activeKeyId: 'k1',
    })
    renderPage()
    fireEvent.click(screen.getByLabelText('B'))
    expect(useSettingsStore.getState().activeKeyId).toBe('k2')
  })

  it('修改默认 Base URL 与模型名 → store 同步更新', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('全局默认 Base URL（可选）'), {
      target: { value: 'https://api.example.com' },
    })
    fireEvent.change(screen.getByLabelText('默认模型名'), {
      target: { value: 'my-model' },
    })
    const s = useSettingsStore.getState()
    expect(s.defaultBaseUrl).toBe('https://api.example.com')
    expect(s.defaultModel).toBe('my-model')
  })

  it('连通性检测成功 → 显示成功文案（mock testConnection，runTest 异步）', async () => {
    mockTestConnection.mockResolvedValue({ ok: true, message: '连接成功：模型 deepseek-chat' })
    useSettingsStore.setState({
      apiKeys: [
        { id: 'k1', name: 'A', key: 'sk-test', baseUrl: 'https://api.example.com', createdAt: 0 },
      ],
      activeKeyId: 'k1',
    })
    renderPage()
    fireEvent.click(screen.getByText('检测连通性'))
    // runTest 是异步路径（aliveRef 守卫），用 findBy* 等待结果渲染
    expect(await screen.findByText('连接成功：模型 deepseek-chat')).toBeInTheDocument()
    expect(mockTestConnection).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      model: 'deepseek-v4-flash',
    })
  })

  it('连通性检测失败 → 显示失败文案', async () => {
    mockTestConnection.mockResolvedValue({ ok: false, message: 'API Key 无效或无权限（401/403）' })
    useSettingsStore.setState({
      apiKeys: [{ id: 'k1', name: 'A', key: 'sk-test', createdAt: 0 }],
      activeKeyId: 'k1',
    })
    renderPage()
    fireEvent.click(screen.getByText('检测连通性'))
    expect(await screen.findByText('API Key 无效或无权限（401/403）')).toBeInTheDocument()
  })

  it('切换语言到英文 → 界面文案跟随（languageFollowsSystem 置 false）', () => {
    renderPage()
    // 中文界面显示 EN 切换按钮
    fireEvent.click(screen.getByText('EN'))
    const s = useSettingsStore.getState()
    expect(s.language).toBe('en')
    expect(s.languageFollowsSystem).toBe(false)
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })
})
