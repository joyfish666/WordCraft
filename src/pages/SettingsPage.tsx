import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LanguageToggle } from '../components/ui/LanguageToggle'
import { useT } from '../i18n'
import { testConnection, type ConnectionTestResult } from '../lib/api'
import { clearDebug } from '../lib/debugLog'
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
  const thinking = useSettingsStore((s) => s.thinking)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const wireframe = useSettingsStore((s) => s.wireframe)
  const debugMode = useSettingsStore((s) => s.debugMode)
  const t = useT()

  const addApiKey = useSettingsStore((s) => s.addApiKey)
  const removeApiKey = useSettingsStore((s) => s.removeApiKey)
  const setActiveKey = useSettingsStore((s) => s.setActiveKey)
  const setDefaultBaseUrl = useSettingsStore((s) => s.setDefaultBaseUrl)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const setThinking = useSettingsStore((s) => s.setThinking)
  const setColorMode = useSettingsStore((s) => s.setColorMode)
  const toggleWireframe = useSettingsStore((s) => s.toggleWireframe)
  const setWireframeLineWidth = useSettingsStore((s) => s.setWireframeLineWidth)
  const setDebugMode = useSettingsStore((s) => s.setDebugMode)

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
      <div className="settings__header">
        <h2 className="page-title">{t('settings.title')}</h2>
        <LanguageToggle />
      </div>

      <section className="panel settings__section">
        <h3 className="panel__title">{t('settings.apiSection')}</h3>
        <p className="settings__desc">{t('settings.apiDesc')}</p>

        <div className="field">
          <label className="field__label" htmlFor="default-base-url">
            {t('settings.defaultBaseUrl')}
          </label>
          <Input
            id="default-base-url"
            value={defaultBaseUrl}
            onChange={(e) => setDefaultBaseUrl(e.target.value)}
            placeholder={t('settings.baseUrlPlaceholder')}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="default-model">
            {t('settings.defaultModel')}
          </label>
          <Input
            id="default-model"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={t('settings.modelPlaceholder')}
          />
        </div>

        <div className="field">
          <span className="field__label">{t('settings.thinking')}</span>
          <div className="segmented">
            <button
              className={`segmented__btn ${thinking === 'disabled' ? 'segmented__btn--active' : ''}`}
              onClick={() => setThinking('disabled')}
            >
              {t('settings.thinkingFast')}
            </button>
            <button
              className={`segmented__btn ${thinking === 'enabled' ? 'segmented__btn--active' : ''}`}
              onClick={() => setThinking('enabled')}
            >
              {t('settings.thinkingDeep')}
            </button>
            <button
              className={`segmented__btn ${thinking === 'default' ? 'segmented__btn--active' : ''}`}
              onClick={() => setThinking('default')}
            >
              {t('settings.thinkingFollow')}
            </button>
          </div>
          <p className="field__hint">{t('settings.thinkingHint')}</p>
        </div>

        <div className="api-form">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.keyNamePlaceholder')}
          />
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('settings.keyPlaceholder')}
          />
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t('settings.keyBaseUrlPlaceholder')}
          />
          <Button onClick={submit} disabled={!name.trim() || !key.trim()}>
            {t('settings.addKey')}
          </Button>
        </div>

        {apiKeys.length === 0 ? (
          <p className="settings__empty">{t('settings.noKeys')}</p>
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
                      {entry.id === activeKeyId && <em className="api-item__tag">{t('settings.currentTag')}</em>}
                    </span>
                    <span className="api-item__meta">
                      {maskKey(entry.key)} · {entry.baseUrl || defaultBaseUrl || t('settings.defaultBaseUrlFallback')}
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
                      {testingId === entry.id ? t('settings.testing') : t('settings.testConnectivity')}
                    </Button>
                    <Button variant="danger" onClick={() => removeApiKey(entry.id)}>
                      {t('settings.delete')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel settings__section">
        <h3 className="panel__title">{t('settings.visualSection')}</h3>

        <div className="field">
          <span className="field__label">{t('settings.colorMode')}</span>
          <div className="segmented">
            <button
              className={`segmented__btn ${colorMode === 'standard' ? 'segmented__btn--active' : ''}`}
              onClick={pickColorMode('standard')}
            >
              {t('settings.colorStandard')}
            </button>
            <button
              className={`segmented__btn ${colorMode === 'colorblind' ? 'segmented__btn--active' : ''}`}
              onClick={pickColorMode('colorblind')}
            >
              {t('settings.colorColorblind')}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label field__label--row">
            <input type="checkbox" checked={wireframe.enabled} onChange={toggleWireframe} />
            {t('settings.showWireframe')}
          </label>
          <div className="field__slider">
            <span className="field__hint">{t('settings.wireframeWidth')}</span>
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

      <section className="panel settings__section">
        <h3 className="panel__title">{t('settings.debugSection')}</h3>
        <div className="field">
          <label className="field__label field__label--row">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
            />
            {t('settings.debugMode')}
          </label>
          <p className="field__hint">{t('settings.debugHint')}</p>
          <Button variant="ghost" onClick={clearDebug}>
            {t('settings.clearLogs')}
          </Button>
        </div>
      </section>
    </div>
  )
}
