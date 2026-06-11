import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Default to the dev uvicorn (:8099), NOT the Docker nginx (:8091) — the
// container serves the last built image, so pointing dev at it silently tests
// stale code. Override with VITE_API_TARGET to target the container on purpose.
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
