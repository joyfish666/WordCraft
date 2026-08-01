import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      apiKeys: [],
      activeKeyId: null,
      defaultBaseUrl: '',
      defaultModel: 'gpt-3.5-turbo',
      thinking: 'disabled',
      colorMode: 'standard',
      wireframe: { enabled: false, lineWidth: 1 },
    })
  })

  it('默认关闭线框（实体色块渲染）', () => {
    expect(useSettingsStore.getState().wireframe.enabled).toBe(false)
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
      .addApiKey({ name: 'DeepSeek', key: 'sk-ds', baseUrl: 'https://api.deepseek.com/v1' })
    useSettingsStore.getState().setColorMode('colorblind')
    useSettingsStore.getState().toggleWireframe()

    const raw = localStorage.getItem('wordcraft.settings')
    expect(raw).not.toBeNull()
    const saved = JSON.parse(raw as string) as {
      state: { apiKeys: { name: string }[]; colorMode: string; wireframe: { enabled: boolean } }
    }
    expect(saved.state.apiKeys[0].name).toBe('DeepSeek')
    expect(saved.state.colorMode).toBe('colorblind')
    // 默认关闭线框，toggle 后开启
    expect(saved.state.wireframe.enabled).toBe(true)
  })
})
