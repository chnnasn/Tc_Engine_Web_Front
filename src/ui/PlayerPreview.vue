<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Game } from './data'
import AppModal from './AppModal.vue'
import EngineSurface from './EngineSurface.vue'
defineProps<{ game: Game }>()
const emit = defineEmits<{ close: [] }>()
const bytes = ref<Uint8Array>()
const error = ref('')
const running = ref(false)
const generation = ref(0)
const fileName = ref('')
// 托管（C#）包与桌面包的错误文案不同：区分“能力不支持”和“包本身损坏”。
const hint = computed(() => {
  const message = error.value
  if (!message) return ''
  if (/portable|managed|win-x64|native|托管|原生/i.test(message)) return '该资源包使用桌面端托管载荷或原生依赖。网页端只支持 portable 纯托管 C# 包，请在桌面编辑器重新 Cook 后再试。'
  if (/tcpak|package|corrupt|invalid|版本|version/i.test(message)) return '资源包损坏或引擎版本不匹配，请使用当前引擎重新打包。'
  return ''
})
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  if (!file.size || file.size > 256 * 1024 * 1024) { error.value = '请选择不超过 256 MiB 的 TCPAK'; return }
  try { bytes.value = new Uint8Array(await file.arrayBuffer()); fileName.value = file.name; generation.value++; error.value = ''; running.value = false }
  catch { error.value = '资源包读取失败' }
}
function stop() { bytes.value = undefined; running.value = false; error.value = ''; fileName.value = '' }
</script>
<template>
  <AppModal :title="`${game.title} · 播放器`" wide @close="emit('close')">
    <p class="local-note">示例作品尚未提供游戏包。选择本地 TCPAK 可在独立的真实引擎播放器中运行：托管（C#）包已支持，但只接受 portable 纯托管载荷，含原生依赖的桌面包会被明确拒绝。</p>
    <label class="field-label">打开 TCPAK 资源包<input type="file" accept=".tcpak" @change="choose" /></label>
    <p v-if="error" role="alert">{{ error }}<span v-if="hint" class="player-hint">{{ hint }}</span></p>
    <p v-if="running" role="status">正在运行本地游戏包{{ fileName ? `：${fileName}` : '' }}（C# 脚本已在浏览器内加载）</p>
    <div v-if="bytes" class="runtime-player"><EngineSurface :key="generation" kind="player" :bytes="bytes" @ready="running = true" @error="error = $event; running = false" /></div>
    <div class="dialog-actions"><button class="button" :disabled="!bytes" @click="stop">停止</button><button class="button button-primary" @click="emit('close')">关闭播放器</button></div>
  </AppModal>
</template>
<style scoped>.runtime-player{height:55vh;min-height:320px;margin-top:16px}input{display:block;margin:12px 0}.player-hint{display:block;margin-top:6px;color:#7b848f;font-size:13px}</style>
