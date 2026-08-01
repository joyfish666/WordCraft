interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

/** 操作说明子界面：列出全部模型操作方式 */
export function HelpDialog({ open, onClose }: HelpDialogProps) {
  if (!open) return null
  return (
    <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog__title">操作说明</h3>
        <ul className="dialog__list">
          <li>
            <strong>旋转视角</strong> — 鼠标左键拖拽（触屏单指拖动）
          </li>
          <li>
            <strong>平移视角</strong> — 鼠标右键 / 中键拖拽
          </li>
          <li>
            <strong>缩放视角</strong> — 滚轮（触屏双指捏合）
          </li>
          <li>
            <strong>选择模块</strong> — 点击场景中的房间 / 家具
          </li>
          <li>
            <strong>聚焦房间</strong> — 点击房间进入其内部视图，内部家具实体化、其他房间虚化
          </li>
          <li>
            <strong>退出聚焦</strong> — 点击整屋地板、面包屑「房屋」，或点空白处
          </li>
          <li>
            <strong>移动视角</strong> — 键盘方向键或状态栏「视角」按钮平移视角
          </li>
          <li>
            <strong>方向键</strong> — ←/→ 左右平移，↑/↓ 上下平移（输入框聚焦时不生效）
          </li>
          <li>
            <strong>复位视角</strong> — 状态栏「复位视角」按钮恢复初始视角
          </li>
          <li>
            <strong>层级导航</strong> — 底部面包屑可点击跳转到任意层级
          </li>
        </ul>
        <div className="dialog__actions">
          <button className="btn btn--primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
