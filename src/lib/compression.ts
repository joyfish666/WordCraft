import LZString from 'lz-string'

/** 分享口令版本前缀：v3 起编码时携带，旧口令（无前缀）解码走降级（内容 JSON 内 version 迁移） */
export const SHARE_CODE_PREFIX = 'wc3:'

/** 将模型 JSON 压缩为分享口令（带版本前缀） */
export function encodeShareCode(json: string): string {
  return SHARE_CODE_PREFIX + LZString.compressToEncodedURIComponent(json)
}

/** 将分享口令还原为模型 JSON（兼容无前缀的旧口令）；口令无效时返回空字符串 */
export function decodeShareCode(code: string): string {
  try {
    const raw = code.startsWith(SHARE_CODE_PREFIX) ? code.slice(SHARE_CODE_PREFIX.length) : code
    return LZString.decompressFromEncodedURIComponent(raw) ?? ''
  } catch {
    return ''
  }
}

/** 便捷：任意可序列化对象 → 分享口令 */
export function compressObject<T>(data: T): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(data))
}

/** 便捷：分享口令 → 对象；解析失败返回 null */
export function decompressObject<T>(code: string): T | null {
  const json = decodeShareCode(code)
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
