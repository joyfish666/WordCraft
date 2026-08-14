import { useT, type TKey } from '../../i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

/** 操作说明子界面：列出全部模型操作方式 */
export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const t = useT()
  if (!open) return null

  const rows: [TKey, TKey][] = [
    ['help.rotate', 'help.rotateDesc'],
    ['help.pan', 'help.panDesc'],
    ['help.zoom', 'help.zoomDesc'],
    ['help.select', 'help.selectDesc'],
    ['help.edit', 'help.editDesc'],
    ['help.undoRedo', 'help.undoRedoDesc'],
    ['help.focus', 'help.focusDesc'],
    ['help.unfocus', 'help.unfocusDesc'],
    ['help.move', 'help.moveDesc'],
    ['help.keys', 'help.keysDesc'],
    ['help.resetView', 'help.resetViewDesc'],
    ['help.breadcrumb', 'help.breadcrumbDesc'],
    ['help.projects', 'help.projectsDesc'],
    ['help.undoGeneration', 'help.undoGenerationDesc'],
    ['help.planView', 'help.planViewDesc'],
  ]

  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')}>
      <ul className="dialog__list">
        {rows.map(([termKey, descKey]) => (
          <li key={termKey}>
            <strong>{t(termKey)}</strong> — <span>{t(descKey)}</span>
          </li>
        ))}
      </ul>
      <div className="dialog__actions">
        <Button variant="primary" onClick={onClose}>
          {t('help.close')}
        </Button>
      </div>
    </Dialog>
  )
}
