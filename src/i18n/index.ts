import { useCallback } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { translate, type TKey } from './translations'

export type { Lang, TKey } from './translations'

/** 翻译插值参数：{name} / {count} 等占位符 */
export type TParams = Record<string, string | number>

/**
 * 非响应式翻译：读取当前语言设置（供 lib / 抛出错误时使用）。
 * 组件内请用 useT()，保证语言切换时重渲染。
 */
export function t(key: TKey, params?: TParams): string {
  return translate(useSettingsStore.getState().language, key, params)
}

/**
 * 响应式翻译 hook：订阅语言设置，语言切换时组件自动重渲染。
 */
export function useT(): (key: TKey, params?: TParams) => string {
  const language = useSettingsStore((s) => s.language)
  return useCallback((key, params) => translate(language, key, params), [language])
}
