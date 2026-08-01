import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { testConnection, type ConnectionTestResult } from '../lib/api'
import { useSettingsStore } from '../store/useSettingsStore'
import type { ColorMode } from '../types/settings'

function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function SettingsPage() {
  const apiKeys = useSettingsStore((s) => s.apiKeys)
  const activeKeyId = useSettingsStore((s) => s.activeKeyId)
  const defaultBaseUrl = useSettingsStore((s) => s.defaultBaseUrl)
  const defaultModel = useSettingsStore((s) => s.defaultModel)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const wireframe = useSettingsStore((s) => s.wireframe)

  const addApiKey = useSettingsStore((s) => s.addApiKey)
  const removeApiKey = useSettingsStore((s) => s.removeApiKey)
  const setActiveKey = useSettingsStore((s) => s.setActiveKey)
  const setDefaultBaseUrl = useSettingsStore((s) => s.setDefaultBaseUrl)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const setColorMode = useSettingsStore((s) => s.setColorMode)
  const toggleWireframe = useSettingsStore((s) => s.toggleWireframe)
  const setWireframeLineWidth = useSettingsStore((s) => s.setWireframeLineWidth)

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({})

  const submit = () => {
    if (!name.trim() || !key.trim()) return
    addApiKey({ name: name.trim(), key: key.trim(), baseUrl: baseUrl.trim() || undefined })
    setName('')
    setKey('')
    setBaseUrl('')
  }

  const runTest = async (id: string) => {
    const entry = apiKeys.find((k) => k.id === id)
    if (!entry) return
    setTestingId(id)
    const result = await testConnection({
      apiKey: entry.key,
      baseUrl: entry.baseUrl ?? defaultBaseUrl,
      model: defaultModel,
    })
    setResults((prev) => ({ ...prev, [id]: result }))
    setTestingId(null)
  }

  const pickColorMode = (mode: ColorMode) => () => setColorMode(mode)

  return (
    <div className="settings">
      <h2 className="page-title">设置</h2>

      <section className="panel settings__section">
        <h3 className="panel__title">API Key 配置</h3>
        <p className="settings__desc">
          Key 仅保存在浏览器本地，用于调用大模型生成模型。支持 OpenAI / DeepSeek / LocalAI 等兼容接口。
        </p>

        <div className="field">
          <label className="field__label" htmlFor="default-base-url">
            全局默认 Base URL（可选）
          </label>
          <Input
            id="default-base-url"
            value={defaultBaseUrl}
            onChange={(e) => setDefaultBaseUrl(e.target.value)}
            placeholder="如 https://api.deepseek.com/v1，留空使用 https://api.openai.com/v1"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="default-model">
            默认模型名
          </label>
          <Input
            id="default-model"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="如 gpt-3.5-turbo / deepseek-chat，由你的服务商决定"
          />
        </div>

        <div className="api-form">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称，如 DeepSeek 主账号"
          />
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API Key"
          />
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL（可选，覆盖全局默认）"
          />
          <Button onClick={submit} disabled={!name.trim() || !key.trim()}>
            添加
          </Button>
        </div>

        {apiKeys.length === 0 ? (
          <p className="settings__empty">尚未添加 API Key。</p>
        ) : (
          <ul className="api-list">
            {apiKeys.map((entry) => {
              const result = results[entry.id]
              return (
                <li key={entry.id} className="api-item">
                  <label className="api-item__radio">
                    <input
                      type="radio"
                      name="active-key"
                      checked={entry.id === activeKeyId}
                      onChange={() => setActiveKey(entry.id)}
                    />
                  </label>
                  <div className="api-item__info">
                    <span className="api-item__name">
                      {entry.name}
                      {entry.id === activeKeyId && <em className="api-item__tag">当前</em>}
                    </span>
                    <span className="api-item__meta">
                      {maskKey(entry.key)} · {entry.baseUrl || defaultBaseUrl || '默认 Base URL'}
                    </span>
                    {result && (
                      <span className={`test-result ${result.ok ? 'test-result--ok' : 'test-result--error'}`}>
                        {result.message}
                      </span>
                    )}
                  </div>
                  <div className="api-item__actions">
                    <Button
                      variant="ghost"
                      onClick={() => runTest(entry.id)}
                      disabled={testingId !== null}
                    >
                      {testingId === entry.id ? '检测中…' : '检测连通性'}
                    </Button>
                    <Button variant="danger" onClick={() => removeApiKey(entry.id)}>
                      删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel settings__section">
        <h3 className="panel__title">视觉偏好</h3>

        <div className="field">
          <span className="field__label">颜色模式</span>
          <div className="segmented">
            <button
              className={`segmented__btn ${colorMode === 'standard' ? 'segmented__btn--active' : ''}`}
              onClick={pickColorMode('standard')}
            >
              标准模式
            </button>
            <button
              className={`segmented__btn ${colorMode === 'colorblind' ? 'segmented__btn--active' : ''}`}
              onClick={pickColorMode('colorblind')}
            >
              色盲模式
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label field__label--row">
            <input type="checkbox" checked={wireframe.enabled} onChange={toggleWireframe} />
            显示线框
          </label>
          <div className="field__slider">
            <span className="field__hint">线框粗细</span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={wireframe.lineWidth}
              onChange={(e) => setWireframeLineWidth(Number(e.target.value))}
            />
            <span className="field__hint">{wireframe.lineWidth}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
