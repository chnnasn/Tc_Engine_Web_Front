<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Game } from './data'
import AppModal from './AppModal.vue'
import EngineSurface from './EngineSurface.vue'
import engineLock from '../../engine.lock.json'
const props = defineProps<{ game: Game }>()
const emit = defineEmits<{ close: [] }>()
// 引擎侧同样以 256 MiB 为上限，这里提前拦截，避免把超大响应读进内存。
const MAX_PACKAGE = 256 * 1024 * 1024
const bytes = ref<Uint8Array>()
const error = ref('')
const running = ref(false)
const loading = ref(false)
const generation = ref(0)
const stage = ref<HTMLElement>()
const fullscreenError = ref('')
let controller: AbortController | undefined
// 托管（C#）包与桌面包的错误文案不同：区分“能力不支持”和“包本身损坏”。
const hint = computed(() => {
  const message = error.value
  if (!message) return ''
  if (/引擎启动失败|failed to fetch|模块加载失败/i.test(message)) return '引擎资源下载失败，请检查网络连接后重试。'
  if (/portable|managed|win-x64|native|托管|原生/i.test(message)) return '这个资源包暂不支持网页播放，请创作者重新导出网页版本后再试。'
  if (/tcpak|package|corrupt|invalid|版本|version/i.test(message)) return '资源包损坏或引擎版本不匹配，请使用当前引擎重新打包。'
  return ''
})
// 内置示例可直接加载同站资源；已发布作品仍由后端按作品 id 提供。
async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const current = ++generation.value
  loading.value = true
  error.value = ''
  fullscreenError.value = ''
  bytes.value = undefined
  running.value = false
  try {
    const url = new URL(props.game.packageUrl ?? `/v1/games/${encodeURIComponent(props.game.id)}/package`, location.origin)
    url.searchParams.set('engine', engineLock.commit)
    const response = await fetch(url, {
      credentials: 'same-origin', headers: { 'X-TomCat-Request': '1' }, signal: request.signal,
    })
    if (current !== generation.value) return
    if (response.status === 404) { error.value = props.game.packageUrl ? '这个示例的游戏资源暂时无法找到，请稍后重试' : '后端尚未提供这个作品的游戏包'; return }
    if (!response.ok) { error.value = `游戏包下载失败（HTTP ${response.status}）`; return }
    if (response.headers.get('content-type')?.includes('text/html')) { error.value = '游戏资源暂时不可用，请稍后重试'; return }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_PACKAGE) { error.value = '游戏包超过 256 MiB，网页播放器无法加载'; return }
    const buffer = await response.arrayBuffer()
    if (current !== generation.value) return
    if (!buffer.byteLength) { error.value = '游戏包为空，无法运行'; return }
    if (buffer.byteLength > MAX_PACKAGE) { error.value = '游戏包超过 256 MiB，网页播放器无法加载'; return }
    bytes.value = new Uint8Array(buffer)
  } catch (failure) {
    if (current === generation.value && (failure as Error | undefined)?.name !== 'AbortError') error.value = '游戏资源未能加载，请检查网络连接后重试'
  } finally {
    if (current === generation.value) loading.value = false
  }
}
load()
function stop() {
  generation.value++
  controller?.abort()
  bytes.value = undefined; running.value = false; loading.value = false; error.value = ''
  fullscreenError.value = ''
}
function engineError(message: string) { bytes.value = undefined; error.value = message; running.value = false }
async function fullscreen() {
  fullscreenError.value = ''
  try { await stage.value?.requestFullscreen(); stage.value?.querySelector('iframe')?.focus() }
  catch { fullscreenError.value = '当前浏览器无法进入全屏，可以继续在窗口中游玩。' }
}
onBeforeUnmount(stop)
</script>
<template>
  <AppModal class="player-dialog" :title="`${game.title} · 播放器`" wide @close="emit('close')">
    <p class="local-note">{{ game.controls ? '请使用桌面键盘与鼠标，点击游戏画面后操作。首次打开需要加载引擎，请稍候。' : '首次打开需要加载引擎，请稍候。点击游戏画面后即可操作。' }}</p>
    <details v-if="game.controls?.length" class="player-controls"><summary>查看操作说明</summary><div><span v-for="control in game.controls" :key="control.key"><kbd>{{ control.key }}</kbd>{{ control.action }}</span></div></details>
    <p v-if="loading" role="status">正在加载游戏资源…</p>
    <p v-else-if="error" role="alert">{{ error }}<span v-if="hint" class="player-hint">{{ hint }}</span></p>
    <p v-if="running" class="player-status" role="status">{{ game.packageUrl ? `${game.title} 已就绪` : `正在运行 ${game.title} 的游戏包` }}</p>
    <div v-if="bytes" ref="stage" class="runtime-player"><EngineSurface :key="generation" kind="player" :bytes="bytes" @ready="running = true" @error="engineError" @exit="emit('close')" /></div>
    <p v-if="fullscreenError" role="status">{{ fullscreenError }}</p>
    <div class="dialog-actions"><button v-if="running" class="button" @click="fullscreen">全屏游玩</button><button v-if="bytes" class="button" @click="stop">停止</button><button v-else-if="!loading" class="button" @click="load">{{ error ? '重试' : '重新加载' }}</button><button class="button button-primary" @click="emit('close')">关闭播放器</button></div>
  </AppModal>
</template>
<style scoped>.runtime-player{height:55vh;min-height:320px;margin-top:16px}.player-hint{display:block;margin-top:6px;color:#7b848f;font-size:13px}.player-controls{margin:12px 0;font-size:12px;color:#756d63}.player-controls summary{cursor:pointer;width:fit-content}.player-controls>div{display:flex;flex-wrap:wrap;gap:10px 20px;padding:12px 0 0}.player-controls span{display:flex;align-items:center;gap:6px}.player-controls kbd{padding:3px 6px;border:1px solid #e2ddd5;border-radius:4px;font:11px ui-monospace,monospace}.player-status{margin-top:12px;font-size:12px;color:#65725c}</style>
<style scoped>.runtime-player:fullscreen{width:100vw;height:100vh;margin:0;background:#f7f7e2}</style>
