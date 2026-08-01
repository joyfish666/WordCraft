import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SceneViewer } from '../components/viewport/SceneViewer'
import { Button } from '../components/ui/Button'
import { countNodes, getPathToNode, isContainer } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { useModelStore } from '../store/useModelStore'
import { useSettingsStore } from '../store/useSettingsStore'

export function HomePage() {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const setScene = useModelStore((s) => s.setScene)
  const resetScene = useModelStore((s) => s.resetScene)
  const selectNode = useModelStore((s) => s.selectNode)
  const hasApiKey = useSettingsStore((s) => s.activeKeyId != null)

  const [draft, setDraft] = useState('')

  const selected = useMemo(() => {
    if (!scene || !selectedId) return null
    const path = getPathToNode(scene.root, selectedId)
    return path[path.length - 1] ?? null
  }, [scene, selectedId])

  const crumbs = useMemo(
    () => (scene && selectedId ? getPathToNode(scene.root, selectedId) : []),
    [scene, selectedId],
  )

  return (
    <div className="home">
      <header className="home__toolbar">
        <div className="home__toolbar-left">
          <Button variant="ghost" onClick={() => setScene(createSampleModel())}>
            加载示例
          </Button>
          <Button variant="ghost" onClick={resetScene} disabled={!scene}>
            清空场景
          </Button>
        </div>
        <div className="home__toolbar-right">
          {hasApiKey ? (
            <span className="badge badge--ok">API Key 已配置</span>
          ) : (
            <Link to="/settings" className="badge badge--warn">
              未配置 API Key · 前往设置
            </Link>
          )}
        </div>
      </header>

      <div className="home__body">
        <section className="panel home__chat">
          <h2 className="panel__title">对话生成</h2>
          <div className="chat-log">
            {scene ? (
              <p className="chat-log__hint">
                模型已就绪：{scene.root.name}（共 {countNodes(scene.root)} 个模块），点击任意模块查看尺寸。
              </p>
            ) : (
              <p className="chat-log__hint">
                在下方输入需求，或点击「加载示例」查看基础渲染效果。
              </p>
            )}
          </div>
          <div className="chat-input">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：帮我设计一个 3×3 米的卧室，放一张双人床…"
              rows={3}
            />
            <Button disabled title="Phase 1 将接入大模型对话生成">
              生成模型
            </Button>
          </div>
        </section>

        <section className="panel home__viewport">
          <SceneViewer />
        </section>
      </div>

      <footer className="home__statusbar">
        {crumbs.length > 0 && (
          <nav className="breadcrumb">
            {crumbs.map((node, i) => (
              <span key={node.id}>
                {i > 0 && <span className="breadcrumb__sep">/</span>}
                <button className="breadcrumb__link" onClick={() => selectNode(node.id)}>
                  {node.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <span className="dim-info">
          {selected ? (
            <>
              已选：{selected.name} · 长 {selected.dimensions.length}m × 宽{' '}
              {selected.dimensions.width}m × 高 {selected.dimensions.height}m
              {isContainer(selected) ? ` · ${selected.children.length} 个子模块` : ''}
            </>
          ) : (
            '点击模型模块查看尺寸信息'
          )}
        </span>
      </footer>
    </div>
  )
}
