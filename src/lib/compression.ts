import LZString from 'lz-string'

/** 将模型 JSON 压缩为分享口令 */
export function encodeShareCode(json: string): string {
  return LZString.compressToEncodedURIComponent(json)
}

/** 将分享口令还原为模型 JSON；口令无效时返回空字符串 */
export function decodeShareCode(code: string): string {
  try {
    return LZString.decompressFromEncodedURIComponent(code) ?? ''
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
