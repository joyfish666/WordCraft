import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../../store/useSettingsStore'
import { LanguageToggle } from './LanguageToggle'

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ apiKeys: [], activeKeyId: null, language: 'zh' })
})

afterEach(() => {
  cleanup()
})

describe('LanguageToggle', () => {
  it('zh 界面显示 EN，点击切换到 en', () => {
    render(<LanguageToggle />)
    const btn = screen.getByRole('button', { name: '切换为英文' })
    expect(btn.textContent).toBe('EN')
    fireEvent.click(btn)
    expect(useSettingsStore.getState().language).toBe('en')
  })

  it('en 界面显示「中文」，点击切换到 zh', () => {
    useSettingsStore.setState({ language: 'en' })
    render(<LanguageToggle />)
    const btn = screen.getByRole('button', { name: 'Switch to Chinese' })
    expect(btn.textContent).toBe('中文')
    fireEvent.click(btn)
    expect(useSettingsStore.getState().language).toBe('zh')
  })
})
