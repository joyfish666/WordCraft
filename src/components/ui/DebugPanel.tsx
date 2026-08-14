import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { clearDebug, formatDebugText, type DebugEntry } from '../../lib/debugLog'
import { Button } from './Button'

/** 将调试日志下载为 .log 文件（保存到浏览器下载目录，便于直接读取排查） */
function downloadDebug(entries: DebugEntry[]): void {
  const text = formatDebugText(entries)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wordcraft-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  // 挂进 DOM 再点击（部分浏览器要求），并延迟 revoke——立即 revoke 在 Safari 等浏览器上
  // 会在下载真正开始前失效，导致下载失败
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 将调试日志复制到剪贴板 */
async function copyDebug(entries: DebugEntry[]): Promise<void> {
  const text = formatDebugText(entries)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text).catch(() => {})
  }
}

/** 调试日志面板：仅调试模式开启时由 HomePage 渲染；面板开合/复制/下载/清空自持 */
export function DebugPanel({ entries }: { entries: DebugEntry[] }) {
  const t = useT()
  const [open, setOpen] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 日志追加时自动滚动到底部
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  return (
    <section className="debug-panel">
      <div className="debug-panel__header">
        <button
          className="debug-panel__toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="debug-panel-body"
        >
          {open ? '▾' : '▸'} {t('home.debugLog')}
        </button>
        <span className="debug-panel__count">
          {t('home.debugCount', { count: entries.length })}
        </span>
        <div className="debug-panel__actions">
          <Button
            variant="ghost"
            onClick={() => void copyDebug(entries)}
            disabled={entries.length === 0}
          >
            {t('home.copy')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadDebug(entries)}
            disabled={entries.length === 0}
            title={t('home.downloadTitle')}
          >
            {t('home.download')}
          </Button>
          <Button variant="ghost" onClick={clearDebug} disabled={entries.length === 0}>
            {t('home.clear')}
          </Button>
        </div>
      </div>
      {open && (
        <div className="debug-panel__body" id="debug-panel-body" ref={bodyRef}>
          {entries.length === 0 ? (
            <p className="debug-panel__empty">{t('home.debugEmpty')}</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className={`debug-entry debug-entry--${e.level}`}>
                <span className="debug-entry__time">{e.time}</span>
                <span className="debug-entry__msg">{e.message}</span>
                {e.detail && <pre className="debug-entry__detail">{e.detail}</pre>}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
