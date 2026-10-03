import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
const proxy = { '/v1': { target: process.env.TOMCAT_API_PROXY || 'http://127.0.0.1:5080' } }

export default defineConfig({
  server: { proxy, watch: { ignored: ['**/.engine/**'] }, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  optimizeDeps: { entries: ['index.html', 'engine-host.html'] },
  preview: { proxy, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  publicDir: 'public',
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { app: resolve('index.html'), engine: resolve('engine-host.html') } } },
})
