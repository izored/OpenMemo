import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Default to the local uvicorn (dev.ps1) on :8099. Docker users running the
// full stack should set VITE_API_TARGET=http://localhost:8091 explicitly (or
// just hit nginx at :8091 directly without `npm run dev`).
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8099'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/files': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
