import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressObject, encodeShareCode } from '../../lib/compression'
import { createSampleModel } from '../../lib/sampleModel'
import { useShareStore } from '../../store/useShareStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { ShareDialog } from './ShareDialog'

const onRestore = vi.fn()
const onClose = vi.fn()

function renderDialog(overrides: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  return render(
    <ShareDialog
      open
      onClose={onClose}
      code="test-code"
      screenshot="data:image/png;base64,abc"
      onRestore={onRestore}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  localStorage.clear()
  useShareStore.setState({ records: [] })
  useSettingsStore.setState({ language: 'zh' })
  onRestore.mockReset()
  onClose.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ShareDialog（分享与口令）', () => {
  it('展示截图预览与口令，复制按钮可用', () => {
    renderDialog()
    expect(screen.getByRole('img', { name: /场景截图预览/ })).toBeInTheDocument()
    expect(screen.getByDisplayValue('test-code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制口令' })).toBeInTheDocument()
  })

  it('截图失败时显示降级提示（无 img）', () => {
    renderDialog({ screenshot: null })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/截图失败/)).toBeInTheDocument()
  })

  it('无模型（code/screenshot 均为空）时提示可粘贴口令还原', () => {
    renderDialog({ code: null, screenshot: null })
    expect(screen.getByText(/当前无模型/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/粘贴分享口令/)).toBeInTheDocument()
    // 无当前模型：不显示口令/复制区域
    expect(screen.queryByRole('button', { name: '复制口令' })).not.toBeInTheDocument()
  })

  it('粘贴无效口令提示错误且不调用还原', () => {
    renderDialog()
    const input = screen.getByPlaceholderText(/粘贴分享口令/)
    fireEvent.change(input, { target: { value: '!@#invalid' } })
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    expect(screen.getByText(/口令无效/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('粘贴有效口令成功还原模型', () => {
    const code = encodeShareCode(JSON.stringify(createSampleModel()))
    renderDialog({ code })
    const input = screen.getByPlaceholderText(/粘贴分享口令/)
    fireEvent.change(input, { target: { value: code } })
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore.mock.calls[0][0].root.name).toBe('示例小屋')
    expect(screen.getByText(/模型已还原/)).toBeInTheDocument()
  })

  it('旧版 v1 口令还原时自动迁移为 v3 足迹模型（旧数据可打开）', () => {
    // 无前缀口令（旧版格式），内容为 v1 盒子模型
    const v1 = {
      version: 1,
      root: {
        id: 'h1',
        type: 'house',
        name: '旧房子',
        dimensions: { length: 4, width: 3, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        children: [
          {
            id: 'r1',
            type: 'room',
            name: '客厅',
            dimensions: { length: 3, width: 3, height: 2.8 },
            position: { x: 0, y: 1.4, z: 0 },
            children: [],
          },
        ],
      },
    }
    const legacyCode = compressObject(v1)
    renderDialog({ code: legacyCode })
    const input = screen.getByPlaceholderText(/粘贴分享口令/)
    fireEvent.change(input, { target: { value: legacyCode } })
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    const restored = onRestore.mock.calls[0][0] as {
      version: number
      root: { name: string; levels: { rooms: unknown[] }[] }
    }
    expect(restored.version).toBe(3)
    expect(restored.root.name).toBe('旧房子')
    expect(restored.root.levels[0].rooms).toHaveLength(1)
    expect(screen.getByText(/模型已还原/)).toBeInTheDocument()
  })

  it('历史列表显示并可删除', () => {
    useShareStore.getState().addRecord({ name: '旧模型', code: 'old-code' })
    renderDialog()
    expect(screen.getByText('旧模型')).toBeInTheDocument()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByTitle('删除'))
    expect(screen.getByText(/暂无历史口令/)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
