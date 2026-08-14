import { NavLink } from 'react-router-dom'
import { useT } from '../../i18n'
import { LanguageToggle } from './LanguageToggle'
import {
  IconCamera,
  IconChat,
  IconFolder,
  IconGear,
  IconHelp,
  IconHome,
  IconRedo,
  IconSample,
  IconSave,
  IconShare,
  IconTrash,
  IconUndo,
} from './icons'

export interface HomeToolbarProps {
  canClear: boolean
  canSave: boolean
  canUndo: boolean
  canRedo: boolean
  undoTitle: string
  redoTitle: string
  saveTitle: string
  chatCollapsed: boolean
  hasApiKey: boolean
  onLoadSample: () => void
  onClearScene: () => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onOpenLibrary: () => void
  onShare: () => void
  onScreenshot: () => void
  onHelp: () => void
  onToggleChat: () => void
}

/** 首页顶栏：品牌 + 场景/编辑/对话操作组 + 右侧项目组与导航（新 UI 无侧边栏） */
export function HomeToolbar({
  canClear,
  canSave,
  canUndo,
  canRedo,
  undoTitle,
  redoTitle,
  saveTitle,
  chatCollapsed,
  hasApiKey,
  onLoadSample,
  onClearScene,
  onUndo,
  onRedo,
  onSave,
  onOpenLibrary,
  onShare,
  onScreenshot,
  onHelp,
  onToggleChat,
}: HomeToolbarProps) {
  const t = useT()

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <svg
          className="toolbar__brand-logo"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z" />
        </svg>
        <span className="toolbar__brand-text">
          <span className="toolbar__brand-name">{t('app.brandName')}</span>
          <span className="toolbar__brand-sub">{t('app.brandSub')}</span>
        </span>
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="toolbar__btn"
          title={t('home.loadSampleTitle')}
          onClick={onLoadSample}
        >
          <IconSample />
          <span>{t('home.loadSample')}</span>
        </button>
        <button
          type="button"
          className="toolbar__btn"
          title={t('home.clearSceneTitle')}
          onClick={onClearScene}
          disabled={!canClear}
        >
          <IconTrash />
          <span>{t('home.clearScene')}</span>
        </button>
      </div>

      <div className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          className="toolbar__btn toolbar__btn--icon-only"
          title={undoTitle}
          aria-label={t('home.undo')}
          onClick={onUndo}
          disabled={!canUndo}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className="toolbar__btn toolbar__btn--icon-only"
          title={redoTitle}
          aria-label={t('home.redo')}
          onClick={onRedo}
          disabled={!canRedo}
        >
          <IconRedo />
        </button>
      </div>

      <div className="toolbar__sep" />

      <button
        type="button"
        className={`toolbar__btn ${chatCollapsed ? '' : 'toolbar__btn--active'}`}
        title={chatCollapsed ? t('home.chatExpandTitle') : t('home.chatCollapseTitle')}
        onClick={onToggleChat}
      >
        <IconChat />
        <span>{t('home.chat')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('home.share')}
        aria-label={t('home.share')}
        onClick={onShare}
      >
        <IconShare />
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('home.screenshotTitle')}
        aria-label={t('home.screenshot')}
        onClick={onScreenshot}
      >
        <IconCamera />
        <span>{t('home.screenshot')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('home.help')}
        aria-label={t('home.help')}
        onClick={onHelp}
      >
        <IconHelp />
      </button>

      <div className="toolbar__right">
        <div className="toolbar__group">
          <button
            type="button"
            className="toolbar__btn toolbar__btn--primary"
            title={saveTitle}
            onClick={onSave}
            disabled={!canSave}
          >
            <IconSave />
            <span>{t('home.save')}</span>
          </button>
          <button
            type="button"
            className="toolbar__btn"
            title={t('home.library')}
            onClick={onOpenLibrary}
          >
            <IconFolder />
            <span>{t('home.library')}</span>
          </button>
        </div>
        <div className="toolbar__sep" />
        <nav className="toolbar__nav" aria-label={t('nav.label')}>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `toolbar__nav-btn ${isActive ? 'toolbar__nav-btn--active' : ''}`
            }
            data-label={t('nav.home')}
            aria-label={t('nav.home')}
          >
            <IconHome />
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `toolbar__nav-btn ${isActive ? 'toolbar__nav-btn--active' : ''}`
            }
            data-label={t('nav.settings')}
            aria-label={t('nav.settings')}
          >
            <IconGear />
          </NavLink>
        </nav>
        <LanguageToggle className="lang-btn" />
        {hasApiKey ? (
          <span className="badge badge--ok">{t('home.apiOk')}</span>
        ) : (
          <NavLink to="/settings" className="badge badge--warn" title={t('home.apiMissing')}>
            {t('home.apiMissing')}
          </NavLink>
        )}
      </div>
    </header>
  )
}
