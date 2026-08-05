import { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'

export type DebugLevel = 'info' | 'warn' | 'error'

export interface DebugEntry {
  id: number
  time: string
  level: DebugLevel
  message: string
  /** 附加详情（JSON 字符串） */
  detail?: string
}

let entries: DebugEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()
const MAX_ENTRIES = 400

function notify(): void {
  for (const cb of listeners) cb()
}

function stringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * 记录一条调试日志。仅在「调试模式」开启时输出（界面面板 + 浏览器控制台）。
 * 生成链路各处调用，用于向开发者复现当前发生了什么。
 */
export function logDebug(message: string, detail?: unknown, level: DebugLevel = 'info'): void {
  if (!useSettingsStore.getState().debugMode) return
  const entry: DebugEntry = {
    id: nextId++,
    time: new Date().toLocaleTimeString(),
    level,
    message,
    detail: detail === undefined ? undefined : stringify(detail),
  }
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry]

  const tag = `[WordCraft][${level}] ${entry.message}`
  if (level === 'error') console.error(tag, entry.detail ?? '')
  else if (level === 'warn') console.warn(tag, entry.detail ?? '')
  else console.log(tag, entry.detail ?? '')
  notify()
}

export function getDebugEntries(): DebugEntry[] {
  return entries
}

export function subscribeDebug(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function clearDebug(): void {
  entries = []
  notify()
}

/** React hook：订阅调试日志列表 */
export function useDebugEntries(): DebugEntry[] {
  const [state, setState] = useState<DebugEntry[]>(getDebugEntries)
  useEffect(() => subscribeDebug(() => setState(getDebugEntries())), [])
  return state
}
