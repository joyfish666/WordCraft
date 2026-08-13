import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      apiKeys: [],
      activeKeyId: null,
      defaultBaseUrl: '',
      defaultModel: 'deepseek-v4-flash',
      thinking: 'disabled',
      colorMode: 'standard',
      wireframe: { enabled: false, lineWidth: 1 },
      shadows: true,
      debugMode: false,
      language: 'zh',
    })
  })

  it('setLanguage 切换语言并持久化', () => {
    useSettingsStore.getState().setLanguage('en')
    expect(useSettingsStore.getState().language).toBe('en')
    const saved = JSON.parse(localStorage.getItem('wordcraft.settings') as string) as {
      state: { language: string }
    }
    expect(saved.state.language).toBe('en')
  })

  it('v2 旧数据迁移：缺 language 字段时回退为 zh', async () => {
    // 先让当前状态为 en（会写入 v3），再覆写为无 language 的 v2 数据，验证 migrate 补回 zh
    useSettingsStore.setState({ language: 'en' })
    localStorage.setItem(
      'wordcraft.settings',
      JSON.stringify({
        state: {
          apiKeys: [],
          activeKeyId: null,
          defaultBaseUrl: '',
          defaultModel: 'deepseek-v4-flash',
          thinking: 'disabled',
          colorMode: 'standard',
          wireframe: { enabled: false, lineWidth: 1 },
          debugMode: false,
        },
        version: 2,
      }),
    )
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().language).toBe('zh')
  })

  it('v3 旧数据迁移：缺 shadows 时默认开启（造型层不丢）', async () => {
    useSettingsStore.setState({ shadows: false })
    localStorage.setItem(
      'wordcraft.settings',
      JSON.stringify({
        state: {
          apiKeys: [],
          activeKeyId: null,
          defaultBaseUrl: '',
          defaultModel: 'deepseek-v4-flash',
          thinking: 'disabled',
          colorMode: 'standard',
          wireframe: { enabled: false, lineWidth: 1 },
          debugMode: false,
          language: 'zh',
        },
        version: 3,
      }),
    )
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().shadows).toBe(true)
  })

  it('默认关闭线框（实体色块渲染）', () => {
    expect(useSettingsStore.getState().wireframe.enabled).toBe(false)
  })

  it('阴影开关默认开启且可切换并持久化', () => {
    const s = useSettingsStore.getState()
    expect(s.shadows).toBe(true)
    s.setShadows(false)
    expect(useSettingsStore.getState().shadows).toBe(false)
    const saved = JSON.parse(localStorage.getItem('wordcraft.settings') as string) as {
      state: { shadows: boolean }
    }
    expect(saved.state.shadows).toBe(false)
  })

  it('新增 API Key 并自动激活', () => {
    const id = useSettingsStore.getState().addApiKey({ name: 'OpenAI', key: 'sk-test-123' })
    const state = useSettingsStore.getState()
    expect(state.apiKeys).toHaveLength(1)
    expect(state.activeKeyId).toBe(id)
  })

  it('切换并删除激活 Key 后回退到剩余项', () => {
    const a = useSettingsStore.getState().addApiKey({ name: 'A', key: 'key-a' })
    const b = useSettingsStore.getState().addApiKey({ name: 'B', key: 'key-b' })
    useSettingsStore.getState().setActiveKey(a)
    useSettingsStore.getState().removeApiKey(a)
    const state = useSettingsStore.getState()
    expect(state.apiKeys).toHaveLength(1)
    expect(state.activeKeyId).toBe(b)
  })

  it('删除全部 Key 后激活项为 null', () => {
    const a = useSettingsStore.getState().addApiKey({ name: 'A', key: 'key-a' })
    useSettingsStore.getState().removeApiKey(a)
    const state = useSettingsStore.getState()
    expect(state.apiKeys).toHaveLength(0)
    expect(state.activeKeyId).toBeNull()
  })

  it('设置变更持久化到 localStorage', () => {
    useSettingsStore
      .getState()
      .addApiKey({ name: 'DeepSeek', key: 'sk-ds', baseUrl: 'https://api.deepseek.com' })
    useSettingsStore.getState().setColorMode('colorblind')
    useSettingsStore.getState().toggleWireframe()

    const raw = localStorage.getItem('wordcraft.settings')
    expect(raw).not.toBeNull()
    const saved = JSON.parse(raw as string) as {
      state: { apiKeys: { name: string }[]; colorMode: string; wireframe: { enabled: boolean } }
    }
    expect(saved.state.apiKeys[0]!.name).toBe('DeepSeek')
    expect(saved.state.colorMode).toBe('colorblind')
    // 默认关闭线框，toggle 后开启
    expect(saved.state.wireframe.enabled).toBe(true)
  })
})
