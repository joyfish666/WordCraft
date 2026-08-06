/**
 * 在截图右下角绘制分享口令水印（半透明白色文本），返回带水印的 PNG dataURL。
 * 环境不支持 canvas 2D（如 jsdom 测试 / Image 加载失败）时降级返回原图。
 */
export function withWatermark(pngUrl: string, code: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height) {
          resolve(pngUrl)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(pngUrl)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        // 右下角口令水印：字号随截图宽度缩放
        const fontSize = Math.max(16, Math.round(width * 0.018))
        ctx.font = `${fontSize}px monospace`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
        const pad = Math.round(fontSize * 0.8)
        ctx.fillText(code, width - pad, height - pad)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(pngUrl)
      }
    }
    img.onerror = () => resolve(pngUrl)
    img.src = pngUrl
  })
}
