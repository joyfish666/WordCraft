import { describe, expect, it } from 'vitest'
import { en, translate, zh, type TKey } from './translations'

describe('翻译词典', () => {
  it('zh / en key 集合完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('插值替换 {占位符}', () => {
    expect(translate('zh', 'chat.generatedModel', { name: '小屋', count: 5 })).toBe(
      '已生成「小屋」模型，共 5 个模块。可点击模块查看/修改尺寸，或用方向键移动视角。',
    )
    expect(translate('en', 'chat.generatedModel', { name: 'Cabin', count: 5 })).toBe(
      'Generated "Cabin" with 5 modules. Click a module to view/edit dimensions, or use the arrow keys to move the view.',
    )
    expect(translate('zh', 'plan.length', { width: 7 })).toBe('总长 7m')
    expect(translate('en', 'plan.length', { width: 7 })).toBe('Length 7m')
  })

  it('缺失 key 回退 zh，再回退 key 本身', () => {
    // 模拟一个词典中不存在的 key（仅测试回退路径）
    expect(translate('en', 'missing.key' as TKey)).toBe('missing.key')
    expect(translate('zh', 'missing.key' as TKey)).toBe('missing.key')
  })

  it('所有 key 都有中文值且非空', () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(v, k).toBeTruthy()
    }
  })

  it('所有英文值非空', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, k).toBeTruthy()
    }
  })
})
