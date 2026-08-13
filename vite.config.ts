/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json'

export default defineConfig({
  // 版本号单一来源：package.json（编译期注入 __APP_VERSION__，供 UI 状态栏等展示）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  // GitHub Pages 项目站点路径（仓库名 WordCraft）；本地 dev 不受影响
  base: '/WordCraft/',
  build: {
    // three.js 独立 chunk 体积固有，放宽告警阈值
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          // three.js 体积较大，单独分包以优化首屏加载
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
