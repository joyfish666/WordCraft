import { useEffect, useRef, useState } from 'react'
import { decompressObject } from '../../lib/compression'
import { migrateModel } from '../../lib/migration'
import { useT } from '../../i18n'
import { useShareStore } from '../../store/useShareStore'
import type { SceneModel } from '../../types/model'
import { Button } from './Button'
import { useConfirm } from './useConfirm'
import { Dialog } from './Dialog'

export interface ShareDialogProps {
  open: boolean
  onClose: () => void
  /** 当前场景的分享口令（lz-string 压缩；生成前可能为 null） */
  code: string | null
  /** 截图 PNG dataURL（含口令水印；截图失败时为 null） */
  screenshot: string | null
  /** 口令还原成功：由 HomePage 负责未保存守卫、setScene 与清理 */
  onRestore: (model: SceneModel) => void
}

/** 时间戳 → 本地化字符串（"2026/8/5 22:30"） */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 分享与口令对话框：
 * - 展示截图预览 + 模型口令（复制）；
 * - 粘贴口令还原模型（解压 + 校验后调用 onRestore）；
 * - 历史口令列表（useShareStore 持久化，可还原/删除）。
 */
export function ShareDialog({ open, onClose, code, screenshot, onRestore }: ShareDialogProps) {
  const t = useT()
  const { confirm } = useConfirm()
  const records = useShareStore((s) => s.records)
  const removeRecord = useShareStore((s) => s.removeRecord)

  const [paste, setPaste] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const aliveRef = useRef(true)

  // 每次打开重置临时状态；卸载后不再 setState（避免 React 告警）
  useEffect(() => {
    aliveRef.current = true
    setPaste('')
    setCopied(false)
    setMsg(null)
    return () => {
      aliveRef.current = false
    }
  }, [open])

  if (!open) return null

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard?.writeText(code)
    } catch {
      // 剪贴板不可用（权限/非安全上下文）：静默，仅提示已复制
    }
    setCopied(true)
    window.setTimeout(() => {
      if (aliveRef.current) setCopied(false)
    }, 1500)
  }

  /** 校验并还原口令（旧 v1 口令自动迁移为 v3）：成功返回 true，失败提示错误 */
  const tryRestore = (rawCode: string): boolean => {
    const parsed = decompressObject<unknown>(rawCode.trim())
    const model = migrateModel(parsed)
    if (!model) {
      setMsg({ kind: 'err', text: t('share.invalid') })
      return false
    }
    onRestore(model)
    setPaste('')
    setMsg({ kind: 'ok', text: t('share.restored') })
    return true
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('share.title')} className="dialog--share">
      {screenshot ? (
        <img className="share-shot" src={screenshot} alt={t('share.screenshotAlt')} />
      ) : code ? (
        <p className="share-shot__fallback">{t('share.captureFailed')}</p>
      ) : (
        <p className="share-shot__fallback">{t('share.noModel')}</p>
      )}

      {code && (
        <div className="share-code">
          <span className="dialog__section-title">{t('share.codeLabel')}</span>
          <div className="share-code__row">
            <input
              className="input"
              readOnly
              value={code}
              aria-label={t('share.codeLabel')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="ghost" onClick={() => void copyCode()}>
              {copied ? t('share.copied') : t('share.copy')}
            </Button>
          </div>
        </div>
      )}

      <div className="share-restore">
        <span className="dialog__section-title">{t('share.restoreTitle')}</span>
        <div className="share-code__row">
          <input
            className="input"
            value={paste}
            placeholder={t('share.placeholder')}
            aria-label={t('share.restoreTitle')}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && paste.trim()) tryRestore(paste)
            }}
          />
          <Button onClick={() => tryRestore(paste)} disabled={!paste.trim()}>
            {t('share.restore')}
          </Button>
        </div>
        {msg && <p className={`share-msg share-msg--${msg.kind}`}>{msg.text}</p>}
      </div>

      <div className="share-history">
        <span className="dialog__section-title">{t('share.historyTitle')}</span>
        {records.length === 0 ? (
          <p className="share-history__empty">{t('share.empty')}</p>
        ) : (
          <ul className="share-history__list">
            {records.map((r) => (
              <li key={r.id} className="share-history__row">
                <span className="share-history__name">{r.name ?? t('share.unnamed')}</span>
                <span className="share-history__meta">{formatTime(r.createdAt)}</span>
                <div className="share-history__actions">
                  <Button variant="ghost" onClick={() => tryRestore(r.code)}>
                    {t('share.restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    title={t('share.delete')}
                    aria-label={t('share.delete')}
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t('share.deleteTitle'),
                          message: t('share.deleteConfirm'),
                          danger: true,
                        })
                        if (ok) removeRecord(r.id)
                      })()
                    }}
                  >
                    ×
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dialog__actions">
        <Button variant="ghost" onClick={onClose}>
          {t('share.close')}
        </Button>
      </div>
    </Dialog>
  )
}
