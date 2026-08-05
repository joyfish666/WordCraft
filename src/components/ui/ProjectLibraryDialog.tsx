import { useEffect, useRef, useState } from 'react'
import {
  deleteProject,
  listProjects,
  saveProject,
  updateProject,
  type ProjectRecord,
} from '../../db/database'
import { useModelStore } from '../../store/useModelStore'
import { useProjectStore } from '../../store/useProjectStore'
import { Button } from './Button'

export interface ProjectLibraryDialogProps {
  open: boolean
  onClose: () => void
  /** 打开项目：由 HomePage 负责未保存守卫、读取数据、setScene 并绑定项目 */
  onOpenProject: (id: number, name: string) => void
  /** 保存为新项目成功后回调（HomePage 绑定当前项目并快照已保存场景） */
  onProjectCreated: (id: number, name: string) => void
}

/** 时间戳 → 本地化字符串（"2026/8/5 22:30"） */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 本地项目库：保存 / 切换 / 重命名 / 删除多个设计方案。
 * 数据存 Dexie（IndexedDB），列表每次变更后重新读取；当前项目高亮。
 */
export function ProjectLibraryDialog({
  open,
  onClose,
  onOpenProject,
  onProjectCreated,
}: ProjectLibraryDialogProps) {
  const scene = useModelStore((s) => s.scene)
  const currentId = useProjectStore((s) => s.currentId)
  const setCurrentName = useProjectStore((s) => s.setCurrentName)

  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // 组件卸载/关闭后不再 setState，避免异步续体在测试/React 销毁后触发告警
  const aliveRef = useRef(true)

  const reload = async () => {
    const list = await listProjects()
    if (aliveRef.current) setProjects(list)
  }

  useEffect(() => {
    aliveRef.current = true
    if (open) {
      void listProjects().then((list) => {
        if (aliveRef.current) setProjects(list)
      })
    }
    return () => {
      aliveRef.current = false
    }
  }, [open])

  if (!open) return null

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || !scene) return
    const id = await saveProject({ name: trimmed, data: JSON.stringify(scene) })
    if (!aliveRef.current) return
    onProjectCreated(id, trimmed)
    setName('')
    await reload()
  }

  const handleDelete = async (rec: ProjectRecord) => {
    if (!rec.id) return
    if (!window.confirm(`确定删除项目「${rec.name}」吗？删除后无法恢复。`)) return
    await deleteProject(rec.id)
    if (!aliveRef.current) return
    if (rec.id === currentId) useProjectStore.getState().clearProject()
    await reload()
  }

  const commitRename = async (rec: ProjectRecord) => {
    const trimmed = renameDraft.trim()
    if (rec.id && trimmed && trimmed !== rec.name) {
      await updateProject(rec.id, { name: trimmed })
      if (!aliveRef.current) return
      if (rec.id === currentId) setCurrentName(trimmed)
      await reload()
    }
    if (aliveRef.current) setRenamingId(null)
  }

  return (
    <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dialog dialog--project" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog__title">本地项目库</h3>

        <div className="project-create">
          <input
            className="input"
            autoFocus
            placeholder="项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
            }}
          />
          <Button onClick={() => void handleCreate()} disabled={!name.trim() || !scene}>
            保存当前场景
          </Button>
        </div>

        <div className="project-list">
          {projects.length === 0 ? (
            <p className="project-list__empty">暂无项目。保存当前场景以创建第一个项目。</p>
          ) : (
            projects.map((rec) => {
              const isCurrent = rec.id === currentId
              const isRenaming = rec.id === renamingId
              let nodeCount = 0
              try {
                const parsed = JSON.parse(rec.data) as { root?: { children?: unknown[] } }
                nodeCount = parsed?.root?.children?.length ?? 0
              } catch {
                nodeCount = 0
              }
              return (
                <div key={rec.id} className={`project-row ${isCurrent ? 'project-row--current' : ''}`}>
                  {isRenaming ? (
                    <input
                      className="input project-row__rename"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(rec)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => void commitRename(rec)}
                    />
                  ) : (
                    <div className="project-row__info">
                      <span className="project-row__name">
                        {rec.name}
                        {isCurrent && <span className="project-row__tag">当前</span>}
                      </span>
                      <span className="project-row__meta">
                        {formatTime(rec.updatedAt)} · {nodeCount} 个房间
                      </span>
                    </div>
                  )}
                  <div className="project-row__actions">
                    <Button variant="ghost" onClick={() => onOpenProject(rec.id!, rec.name)}>
                      打开
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRenamingId(rec.id!)
                        setRenameDraft(rec.name)
                      }}
                    >
                      重命名
                    </Button>
                    <Button variant="danger" onClick={() => void handleDelete(rec)}>
                      删除
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="dialog__actions">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}
