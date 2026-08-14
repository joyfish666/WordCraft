import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeDims, nodePosition } from '../../lib/footprint'
import { findNodeById } from '../../lib/modelTree'
import { createSampleModel } from '../../lib/sampleModel'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { FurnitureNode } from '../../types/model'
import { PropertyPanel } from './PropertyPanel'

/** 取示例模型的客厅沙发作为受测节点（布局引擎首房间为走廊，按 id 查找） */
function getSofaNode(): FurnitureNode {
  const scene = createSampleModel()
  for (const room of scene.root.levels[0]!.rooms) {
    for (const f of room.furniture) {
      if (f.id === 'sofa-living') return f
    }
  }
  throw new Error('sofa-living not found in sample model')
}

function resetStores(node: FurnitureNode) {
  const scene = createSampleModel()
  useModelStore.setState({
    scene,
    selectedId: node.id,
    focusId: null,
    initialPositions: { [node.id]: nodePosition(node) },
    past: [],
    future: [],
  })
  useSettingsStore.setState({
    language: 'zh',
    colorMode: 'standard',
    wireframe: { enabled: false, lineWidth: 1 },
  })
}

beforeEach(() => {
  localStorage.clear()
  resetStores(getSofaNode())
})

afterEach(() => {
  cleanup()
})

describe('PropertyPanel', () => {
  it('显示选中节点的名称与类型', () => {
    render(<PropertyPanel node={getSofaNode()} />)
    expect(screen.getByText('家具')).toBeInTheDocument()
    expect(screen.getByDisplayValue('沙发')).toBeInTheDocument()
  })

  it('尺寸输入 Enter 提交后更新 store 场景', () => {
    const node = getSofaNode()
    render(<PropertyPanel node={node} />)
    const lengthInput = screen.getByLabelText('长') as HTMLInputElement
    fireEvent.change(lengthInput, { target: { value: '2.5' } })
    fireEvent.keyDown(lengthInput, { key: 'Enter' })
    const updated = findNodeById(useModelStore.getState().scene!.root, node.id) as FurnitureNode
    expect(updated.dimensions.length).toBe(2.5)
    // 提交记入撤销历史（一次编辑一步）
    expect(useModelStore.getState().past.length).toBe(1)
  })

  it('非法输入（小于最小值的数值）回显原值不提交', () => {
    const node = getSofaNode()
    render(<PropertyPanel node={node} />)
    const lengthInput = screen.getByLabelText('长') as HTMLInputElement
    fireEvent.change(lengthInput, { target: { value: '0.05' } })
    fireEvent.keyDown(lengthInput, { key: 'Enter' })
    expect(useModelStore.getState().past.length).toBe(0)
    // 非法值提交被拒绝，输入框回显节点当前尺寸（dims 经布局引擎可能已交换长宽）
    expect(lengthInput.value).toBe(String(parseFloat(nodeDims(node).length.toFixed(3))))
  })

  it('位置微调按钮按步长平移选中家具', () => {
    const node = getSofaNode()
    render(<PropertyPanel node={node} />)
    const before = nodePosition(node)
    fireEvent.click(screen.getByTitle('向东移'))
    const updated = findNodeById(useModelStore.getState().scene!.root, node.id) as FurnitureNode
    expect(nodePosition(updated).x).toBeCloseTo(before.x + 0.5, 5)
  })

  it('有初始位置时「复位位置」可用，点击后回到初始位置', () => {
    const node = getSofaNode()
    render(<PropertyPanel node={node} />)
    const original = nodePosition(node)
    fireEvent.click(screen.getByTitle('向东移'))
    fireEvent.click(screen.getByTitle('回到加载时的初始位置'))
    const updated = findNodeById(useModelStore.getState().scene!.root, node.id) as FurnitureNode
    expect(nodePosition(updated).x).toBeCloseTo(original.x, 5)
  })

  it('无初始位置时「复位位置」禁用', () => {
    const node = getSofaNode()
    useModelStore.setState({ initialPositions: {} })
    render(<PropertyPanel node={node} />)
    expect(screen.getByTitle('本次会话未记录初始位置')).toBeDisabled()
  })

  it('关闭按钮取消选中', () => {
    const node = getSofaNode()
    render(<PropertyPanel node={node} />)
    fireEvent.click(screen.getByTitle('关闭属性面板'))
    expect(useModelStore.getState().selectedId).toBeNull()
  })

  it('整屋选中时只保留名称输入（尺寸/位置/微调对整屋无几何语义，坑 125）', () => {
    const house = createSampleModel().root
    render(<PropertyPanel node={house} />)
    expect(screen.getByDisplayValue('示例小屋')).toBeInTheDocument()
    // 长/宽/高/X/Y/Z 输入与微调按钮全部不渲染（此前可编辑但提交静默无效）
    expect(screen.queryByLabelText('长')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('宽')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('高')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('X')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Y')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Z')).not.toBeInTheDocument()
    expect(screen.queryByTitle('向东移')).not.toBeInTheDocument()
  })

  it('房间选中时 Y 输入与上下微调禁用（房间高度由层高派生，坑 125）', () => {
    const scene = createSampleModel()
    const room = scene.root.levels[0]!.rooms.find((r) => r.name === '客厅')!
    render(<PropertyPanel node={room} />)
    // Y 输入禁用并给出说明
    expect(screen.getByLabelText('Y')).toBeDisabled()
    expect(screen.getByLabelText('Y')).toHaveAttribute('title', '房间高度由层高决定，不可单独调整')
    // 上下微调禁用（↑↓ 两个按钮同标题），X/Z 方向正常
    for (const btn of screen.getAllByTitle('房间不可上下移动（高度由层高决定）')) {
      expect(btn).toBeDisabled()
    }
    expect(screen.getByTitle('向东移')).toBeEnabled()
    // 尺寸输入仍可编辑（房间尺寸 = 足迹缩放）
    expect(screen.getByLabelText('长')).toBeEnabled()
  })
})
