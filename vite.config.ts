import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const proxy = { '/v1': { target: process.env.TOMCAT_API_PROXY || 'http://127.0.0.1:5080' } }

export default defineConfig({
  server: { proxy, watch: { ignored: ['**/.engine/**'] }, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  optimizeDeps: { entries: ['index.html', 'engine-host.html'] },
  preview: { proxy, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  publicDir: 'public',
  plugins: [vue(), {
    name: 'static-spa-fallback',
    apply: 'build',
    closeBundle() {
      let apiRule = ''
      if (process.env.TOMCAT_API_ORIGIN) {
        const origin = new URL(process.env.TOMCAT_API_ORIGIN)
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('TOMCAT_API_ORIGIN must be an HTTPS origin')
        apiRule = `/v1/* ${origin.origin}/v1/:splat 200\n`
      }
      writeFileSync(resolve('dist/_redirects'), `${apiRule}/* /index.html 200\n`, 'utf8')
    },
  }],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { app: resolve('index.html'), engine: resolve('engine-host.html') } } },
})
