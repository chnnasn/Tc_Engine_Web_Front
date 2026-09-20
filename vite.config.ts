import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  server: { watch: { ignored: ['**/.engine/**'] }, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  optimizeDeps: { entries: ['index.html', 'engine-host.html'] },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  publicDir: 'public',
  plugins: [vue(), {
    name: 'static-spa-fallback',
    apply: 'build',
    closeBundle() { writeFileSync(resolve('dist/_redirects'), '/* /index.html 200\n', 'utf8') },
  }],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { app: resolve('index.html'), engine: resolve('engine-host.html') } } },
})
