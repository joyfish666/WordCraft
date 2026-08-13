import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../components/ui/ConfirmDialog'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { encodeShareCode } from '../lib/compression'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { useShareStore } from '../store/useShareStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { HomePage } from './HomePage'

// jsdom 无 WebGL，mock 掉 3D 视口以聚焦对话交互；暴露 planMode 供视图切换断言
vi.mock('../components/viewport/SceneViewer', () => ({
  SceneViewer: forwardRef(function MockSceneViewer(
    props: { planMode?: boolean },
    ref: React.Ref<HTMLDivElement>,
  ) {
    return (
      <div ref={ref} data-testid="scene-viewer" data-planmode={String(props?.planMode ?? false)} />
    )
  }),
}))

vi.mock('../lib/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chat')>()
  return { ...actual, generateModelFromChat: vi.fn() }
})

const mockGenerate = vi.mocked(generateModelFromChat)

/** 应用内确认/提示对话框挂在 ConfirmProvider 下（与 main.tsx 一致），测试需包裹 */
function renderHome() {
  return render(
    <ConfirmProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>
    </ConfirmProvider>,
  )
}

function resetStores() {
  useChatStore.setState({ messages: [], isGenerating: false, generationStack: [] })
  useModelStore.setState({ scene: null, selectedId: null })
  useProjectStore.setState({ currentId: null, currentName: null, dirty: false })
  useShareStore.setState({ records: [] })
  useSettingsStore.setState({
    apiKeys: [],
    activeKeyId: null,
    defaultBaseUrl: '',
    defaultModel: 'deepseek-v4-flash',
    thinking: 'disabled',
    colorMode: 'standard',
    wireframe: { enabled: false, lineWidth: 1 },
    debugMode: false,
    language: 'zh',
  })
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/帮我设计/), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '生成模型' }))
}

beforeEach(() => {
  localStorage.clear()
  resetStores()
  mockGenerate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('HomePage 对话交互', () => {
  it('未配置 API Key 时点击生成，提示前往设置、不调用模型，且保留草稿（坑 70）', async () => {
    renderHome()
    typeAndSend('设计一个卧室')
    expect(
      await screen.findByText(/尚未配置 API Key，请先前往设置页配置后再试/),
    ).toBeInTheDocument()
    expect(mockGenerate).not.toHaveBeenCalled()
    // 草稿不被清空，用户无需重新输入
    expect(screen.getByPlaceholderText(/帮我设计/)).toHaveValue('设计一个卧室')
  })

  it('生成成功后显示摘要并更新场景模型', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    mockGenerate.mockResolvedValue({ reply: '', model: createSampleModel() })

    renderHome()
    typeAndSend('设计一个小屋')

    expect(await screen.findByText(/已生成「示例小屋」模型/)).toBeInTheDocument()
    await waitFor(() => {
      expect(useModelStore.getState().scene?.root.name).toBe('示例小屋')
    })
  })

  it('生成期间场景被编辑：确认框取消则保留用户编辑、丢弃生成结果（坑 70）', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    const generated = createSampleModel()
    const edited = { ...generated, root: { ...generated.root, name: '用户编辑版' } }
    mockGenerate.mockImplementation(async () => {
      // 模拟生成期间用户手动编辑场景（如拖动房间）
      useModelStore.getState().setScene(edited)
      return { reply: '', model: generated }
    })
    renderHome()
    typeAndSend('设计一个小屋')

    // 冲突确认框出现，点「取消」保留用户编辑
    expect(
      await screen.findByRole('heading', { name: '生成结果与当前编辑冲突' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(await screen.findByText(/生成结果已丢弃：生成期间场景发生了变化/)).toBeInTheDocument()
    // 用户编辑保留，生成结果未覆盖
    expect(useModelStore.getState().scene?.root.name).toBe('用户编辑版')
  })

  it('生成期间场景被编辑：确认应用则覆盖为新生成模型', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    const generated = createSampleModel()
    const edited = { ...generated, root: { ...generated.root, name: '用户编辑版' } }
    mockGenerate.mockImplementation(async () => {
      useModelStore.getState().setScene(edited)
      return { reply: '', model: generated }
    })
    renderHome()
    typeAndSend('设计一个小屋')

    // 冲突确认框出现，点「确定」应用生成结果
    expect(
      await screen.findByRole('heading', { name: '生成结果与当前编辑冲突' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    await waitFor(() => {
      expect(useModelStore.getState().scene?.root.name).toBe('示例小屋')
    })
  })

  it('模型返回业务错误时在对话中展示错误信息', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    mockGenerate.mockRejectedValue(
      new ChatGenerationError('模型请求失败：401 Unauthorized', 'http'),
    )

    renderHome()
    typeAndSend('设计一个卧室')

    expect(await screen.findByText(/模型请求失败：401 Unauthorized/)).toBeInTheDocument()
    expect(useModelStore.getState().scene).toBeNull()
  })

  it('视图模式切换：3D / 平面图 联动 planMode prop', async () => {
    renderHome()
    const viewer = () => screen.getByTestId('scene-viewer')
    expect(viewer().getAttribute('data-planmode')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '平面图' }))
    expect(viewer().getAttribute('data-planmode')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(viewer().getAttribute('data-planmode')).toBe('false')
  })

  it('移动端紧凑视口：平面图工具栏为「工具」+「尺寸」独立按钮 + 弹出面板，选工具即关闭', () => {
    Object.defineProperty(window, 'innerWidth', { value: 904, configurable: true, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true, writable: true })
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: '平面图' }))
    // 常驻工具行不渲染；「工具」「尺寸」两个独立按钮常驻（尺寸不进面板）
    expect(screen.queryByRole('toolbar', { name: '平面图编辑工具' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工具/ })).toBeInTheDocument()
    const dimsBtn = screen.getByRole('button', { name: '尺寸' })
    expect(dimsBtn).toBeInTheDocument()
    // 尺寸开关与面板互不影响，直接切换
    fireEvent.click(dimsBtn)
    expect(useModelStore.getState().showPlanDims).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }))
    expect(useModelStore.getState().showPlanDims).toBe(true)
    // 点开面板：工具列表出现；选择「移动」后面板关闭且工具生效
    fireEvent.click(screen.getByRole('button', { name: /工具/ }))
    expect(screen.getByRole('toolbar', { name: '平面图编辑工具' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    expect(screen.queryByRole('toolbar', { name: '平面图编辑工具' })).not.toBeInTheDocument()
    expect(useModelStore.getState().planTool).toBe('move')
    // 恢复桌面视口
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true })
  })

  it('撤销生成恢复生成前的场景', async () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    const prev = createSampleModel()
    const next = createSampleModel()
    next.root.name = '二次生成'
    useModelStore.setState({ scene: prev })
    mockGenerate.mockResolvedValue({ reply: '', model: next })

    renderHome()
    typeAndSend('再改一下')
    await waitFor(() => expect(useModelStore.getState().scene?.root.name).toBe('二次生成'))

    fireEvent.click(screen.getByRole('button', { name: /撤销生成/ }))
    await waitFor(() => expect(useModelStore.getState().scene?.root.name).toBe('示例小屋'))
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('切换语言为英文后，界面文案变为英文', async () => {
    renderHome()
    // 「示例」出现两处：顶栏按钮 + 空态卡内按钮
    expect(screen.getAllByRole('button', { name: '示例' }).length).toBeGreaterThanOrEqual(1)

    useSettingsStore.getState().setLanguage('en')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Sample' }).length).toBeGreaterThanOrEqual(1),
    )
    expect(screen.queryByRole('button', { name: '示例' })).not.toBeInTheDocument()
  })

  it('未配置 API Key 时，空态卡提示可加载示例模型；点击后加载示例', async () => {
    renderHome()
    expect(screen.getByText(/尚未配置 API Key，可先加载示例模型体验/)).toBeInTheDocument()
    // 空态卡内的「示例」按钮（chip 样式）与顶栏「示例」按钮并存，取空态卡内的
    const loadBtn = screen
      .getAllByRole('button', { name: '示例' })
      .find((b) => b.className.includes('chip'))
    expect(loadBtn).toBeDefined()
    fireEvent.click(loadBtn!)
    // loadSample 含未保存守卫（异步确认），等场景加载完成
    await waitFor(() => expect(useModelStore.getState().scene?.root.name).toBe('示例小屋'))
  })

  it('已配置 API Key 时，空态卡不再提示加载示例', () => {
    useSettingsStore.getState().addApiKey({ name: '测试', key: 'sk-test' })
    renderHome()
    expect(screen.queryByText(/尚未配置 API Key，可先加载示例模型体验/)).not.toBeInTheDocument()
  })

  it('无场景时显示空态引导卡，点击示例标签填入输入框', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: '用一句话，生成你的房子' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '三室一厅一厨' }))
    expect(screen.getByPlaceholderText(/帮我设计/)).toHaveValue('三室一厅一厨，一个公共卫生间')
  })

  it('工具栏「项目库」按钮打开本地项目库对话框', async () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: '项目库' }))
    expect(await screen.findByRole('heading', { name: '本地项目库' })).toBeInTheDocument()
    expect(await screen.findByText(/暂无项目/)).toBeInTheDocument()
  })

  it('工具栏「分享」按钮打开分享对话框并记录口令', async () => {
    renderHome()
    // 顶栏「示例」按钮（与空态卡内按钮同名，取顶栏那个）
    const sampleBtn = screen
      .getAllByRole('button', { name: '示例' })
      .find((b) => b.className.includes('toolbar__btn'))
    expect(sampleBtn).toBeDefined()
    fireEvent.click(sampleBtn!)
    // loadSample 含未保存守卫（异步确认），等场景加载完成再点分享
    await waitFor(() => expect(useModelStore.getState().scene?.root.name).toBe('示例小屋'))
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    expect(await screen.findByRole('heading', { name: '分享与口令' })).toBeInTheDocument()
    // 口令输入框已生成；历史记录写入一条
    expect(document.querySelector('.share-code .input')).not.toBeNull()
    expect(useShareStore.getState().records).toHaveLength(1)
  })

  it('无模型时「分享」按钮仍可用，打开对话框供粘贴口令还原', async () => {
    renderHome()
    // 未加载任何模型：分享按钮可用（用于导入他人模型）
    expect(screen.getByRole('button', { name: '分享' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    expect(await screen.findByRole('heading', { name: '分享与口令' })).toBeInTheDocument()
    expect(await screen.findByText(/当前无模型/)).toBeInTheDocument()
    // 无模型不写入口令历史
    expect(useShareStore.getState().records).toHaveLength(0)
  })

  it('分享口令可粘贴还原模型', async () => {
    const code = encodeShareCode(JSON.stringify(createSampleModel()))
    useModelStore.setState({ scene: createSampleModel() })

    renderHome()
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    await screen.findByRole('heading', { name: '分享与口令' })

    const input = screen.getByPlaceholderText(/粘贴分享口令/)
    fireEvent.change(input, { target: { value: code } })
    // 粘贴区与历史列表各有「还原」按钮，取第一个（粘贴区）
    fireEvent.click(screen.getAllByRole('button', { name: '还原' })[0]!)

    // 游离场景未保存 → 未保存守卫确认框，点「确定」继续还原
    expect(await screen.findByRole('heading', { name: '放弃未保存的修改' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    await waitFor(() => {
      expect(useModelStore.getState().scene?.root.name).toBe('示例小屋')
    })
  })
})
