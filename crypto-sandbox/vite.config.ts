import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
      '@/crypto': path.resolve(__dirname, '../src/client/lib'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/crypto-sandbox'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sandbox: path.resolve(__dirname, 'sandbox.html'),
      },
    },
  },
})
