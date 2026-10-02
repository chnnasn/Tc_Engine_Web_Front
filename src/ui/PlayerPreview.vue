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
const controller = new AbortController()
// 托管（C#）包与桌面包的错误文案不同：区分“能力不支持”和“包本身损坏”。
const hint = computed(() => {
  const message = error.value
  if (!message) return ''
  if (/portable|managed|win-x64|native|托管|原生/i.test(message)) return '该资源包使用桌面端托管载荷或原生依赖。网页端只支持 portable 纯托管 C# 包，请在桌面编辑器重新 Cook 后再试。'
  if (/tcpak|package|corrupt|invalid|版本|version/i.test(message)) return '资源包损坏或引擎版本不匹配，请使用当前引擎重新打包。'
  return ''
})
// 游戏包由后端按作品 id 提供，用户无需（也不应）自己上传。
async function load() {
  loading.value = true
  error.value = ''
  bytes.value = undefined
  running.value = false
  generation.value++
  try {
    const response = await fetch(`/v1/games/${encodeURIComponent(props.game.id)}/package?engine=${engineLock.commit}`, {
      credentials: 'same-origin', headers: { 'X-TomCat-Request': '1' }, signal: controller.signal,
    })
    if (response.status === 404) { error.value = '后端尚未提供这个作品的游戏包'; return }
    if (!response.ok) { error.value = `游戏包下载失败（HTTP ${response.status}）`; return }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_PACKAGE) { error.value = '游戏包超过 256 MiB，网页播放器无法加载'; return }
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength) { error.value = '游戏包为空，无法运行'; return }
    if (buffer.byteLength > MAX_PACKAGE) { error.value = '游戏包超过 256 MiB，网页播放器无法加载'; return }
    bytes.value = new Uint8Array(buffer)
  } catch (failure) {
    if ((failure as Error | undefined)?.name !== 'AbortError') error.value = '无法连接后端，游戏包未能加载'
  } finally {
    loading.value = false
  }
}
load()
function stop() { bytes.value = undefined; running.value = false; error.value = '' }
onBeforeUnmount(() => controller.abort())
</script>
<template>
  <AppModal :title="`${game.title} · 播放器`" wide @close="emit('close')">
    <p class="local-note">播放器会从后端获取这个作品的游戏包（TCPAK），在独立的真实引擎中运行。托管（C#）包已支持；含原生依赖的桌面包会被明确拒绝。</p>
    <p v-if="loading" role="status">正在从后端加载游戏包…</p>
    <p v-else-if="error" role="alert">{{ error }}<span v-if="hint" class="player-hint">{{ hint }}</span></p>
    <p v-if="running" role="status">正在运行 {{ game.title }} 的游戏包（C# 脚本已在浏览器内加载）</p>
    <div v-if="bytes" class="runtime-player"><EngineSurface :key="generation" kind="player" :bytes="bytes" @ready="running = true" @error="error = $event; running = false" /></div>
    <div class="dialog-actions"><button v-if="bytes" class="button" @click="stop">停止</button><button v-else-if="!loading" class="button" @click="load">{{ error ? '重试' : '重新加载' }}</button><button class="button button-primary" @click="emit('close')">关闭播放器</button></div>
  </AppModal>
</template>
<style scoped>.runtime-player{height:55vh;min-height:320px;margin-top:16px}.player-hint{display:block;margin-top:6px;color:#7b848f;font-size:13px}</style>
