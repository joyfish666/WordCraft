import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 一条分享口令记录：code 为 lz-string 压缩后的模型口令，还原时解压 */
export interface ShareRecord {
  id: string
  /** 分享时模型名（便于历史列表识别） */
  name?: string
  code: string
  createdAt: number
}

/** 口令历史上限（localStorage 持久化，仅存 code 体积小） */
const SHARE_LIMIT = 20

interface ShareState {
  records: ShareRecord[]
  /** 新增一条记录（置顶，超出上限丢弃最旧） */
  addRecord: (rec: { name?: string; code: string }) => void
  removeRecord: (id: string) => void
  clearRecords: () => void
}

/** 生成会话内唯一 id（时间戳 + 随机后缀，无需 crypto 支持） */
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 分享口令历史：记录用户生成过的模型口令，便于粘贴还原。
 * 只持久化 records（含 code/name/createdAt）；上限 20 条。
 */
export const useShareStore = create<ShareState>()(
  persist(
    (set) => ({
      records: [],

      addRecord: (rec) =>
        set((s) => ({
          records: [{ id: genId(), ...rec, createdAt: Date.now() }, ...s.records].slice(
            0,
            SHARE_LIMIT,
          ),
        })),
      removeRecord: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
      clearRecords: () => set({ records: [] }),
    }),
    {
      name: 'wordcraft.share',
      partialize: (s) => ({ records: s.records }),
    },
  ),
)
