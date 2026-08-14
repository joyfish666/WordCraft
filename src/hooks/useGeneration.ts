import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../components/ui/useConfirm'
import { useT } from '../i18n'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { toChatHistory, useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { getActiveApiConfig, useSettingsStore } from '../store/useSettingsStore'

interface UseGenerationOptions {
  draft: string
  setDraft: (v: string) => void
  setChatCollapsed: (v: boolean | ((c: boolean) => boolean)) => void
}

/**
 * 对话生成链路（HomePage 抽离，坑 C12）：
 * - send：无 key 时保留草稿 → 快照历史发送 → 流式生成 → 生成期间场景已变时
 *   confirm 冲突是否覆盖（P0-1 竞态防护）→ 成功替换场景并解绑项目（生成结果是新游离场景）；
 * - undoGeneration：恢复生成前的场景，并移除对话中对应的 user+assistant 对；
 * - elapsed：生成计时（避免长时间等待时误以为界面卡死）。
 */
export function useGeneration({ draft, setDraft, setChatCollapsed }: UseGenerationOptions) {
  const t = useT()
  const { confirm } = useConfirm()
  const [elapsed, setElapsed] = useState(0)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const addMessage = useChatStore((s) => s.addMessage)
  const setIsGenerating = useChatStore((s) => s.setIsGenerating)
  const setScene = useModelStore((s) => s.setScene)
  // 进行中请求的中止控制器：组件卸载/重新生成时中止，防止完成后静默替换场景
  const abortRef = useRef<AbortController | null>(null)

  // 卸载时中止进行中的生成请求（路由切换/组件卸载后不再 setScene 污染当前场景）
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // 生成计时：避免长时间等待时误以为界面卡死
  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0)
      return
    }
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isGenerating])

  const send = async () => {
    const input = draft.trim()
    // 用 getState() 而非渲染闭包守卫：闭包里的 isGenerating 可能过期，双发窗口内两个请求都会执行
    if (!input || useChatStore.getState().isGenerating) return
    // 发送时展开抽屉，让用户看到请求与回复（含生成中状态与错误消息）
    setChatCollapsed(false)
    const config = getActiveApiConfig(useSettingsStore.getState())
    if (!config) {
      // 无 key 时保留草稿，避免用户辛苦输入的需求被清空
      addMessage({ role: 'error', content: t('home.noApiKey') })
      return
    }
    setDraft('')
    // 先快照历史，避免把即将新增的用户消息重复发送
    const history = toChatHistory(useChatStore.getState().messages)
    addMessage({ role: 'user', content: input })
    setIsGenerating(true)
    const controller = new AbortController()
    abortRef.current = controller
    // 快照生成基线：生成期间场景被编辑/替换时据此检测冲突
    const baseScene = useModelStore.getState().scene
    try {
      const { reply, model } = await generateModelFromChat({
        apiKey: config.key,
        baseUrl: config.baseUrl,
        model: config.model,
        thinking: config.thinking,
        history,
        userInput: input,
        currentScene: baseScene,
        // P3 双向同步：手动编辑日志随上下文喂给 LLM，让 AI 基于用户改过的版本继续
        editOps: useChatStore.getState().editOps,
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        addMessage({ role: 'error', content: t('home.genCancelled') })
        return
      }
      // 生成期间场景已变化（手动编辑/打开项目/加载示例/撤销等）→ 提示冲突，避免静默覆盖
      const latestScene = useModelStore.getState().scene
      if (latestScene !== baseScene) {
        const apply = await confirm({
          title: t('home.genConflictTitle'),
          message: t('home.genConflictApply'),
        })
        if (!apply) {
          addMessage({ role: 'error', content: t('home.genConflictAborted') })
          return
        }
      }
      addMessage({ role: 'assistant', content: reply, model })
      // 记录生成前的场景，供「撤销生成」回退
      const prevScene = useModelStore.getState().scene
      if (prevScene) useChatStore.getState().pushGenerationHistory(prevScene)
      setScene(model)
      // 生成的是全新的未保存场景：解绑项目（含已保存快照），避免误标脏
      useProjectStore.getState().clearProject()
    } catch (error) {
      if (controller.signal.aborted) {
        addMessage({ role: 'error', content: t('home.genCancelled') })
      } else {
        addMessage({
          role: 'error',
          content: error instanceof ChatGenerationError ? error.message : t('home.genFailed'),
        })
      }
    } finally {
      abortRef.current = null
      setIsGenerating(false)
    }
  }

  /** 撤销最近一次生成：恢复生成前的场景，并移除对话中对应的 user+assistant 对 */
  const undoGeneration = () => {
    const prev = useChatStore.getState().undoLastGeneration()
    if (!prev) return
    setScene(prev)
  }

  return { send, undoGeneration, elapsed, isGenerating }
}
