import path from 'node:path'
import { defineConfig } from 'vitest/config'

// This file replaces vite.config.ts for test runs rather than extending it, so
// the `@/` alias has to be repeated here. Without it any test that imports a
// component fails at resolve time, which is how src/components lived without
// tests for so long.
export default defineConfig({
  // Without the react plugin, esbuild here defaults to the classic JSX
  // transform and every .tsx test dies on "React is not defined".
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
