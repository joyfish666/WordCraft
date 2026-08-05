/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
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
