<script setup lang="ts">
import { ref } from 'vue'
import type { Game } from './data'
import AppModal from './AppModal.vue'
import EngineSurface from './EngineSurface.vue'
defineProps<{ game: Game }>()
const emit = defineEmits<{ close: [] }>()
const bytes = ref<Uint8Array>()
const error = ref('')
const running = ref(false)
const generation = ref(0)
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  if (!file.size || file.size > 256 * 1024 * 1024) { error.value = '请选择不超过 256 MiB 的 TCPAK'; return }
  try { bytes.value = new Uint8Array(await file.arrayBuffer()); generation.value++; error.value = ''; running.value = false }
  catch { error.value = '资源包读取失败' }
}
</script>
<template>
  <AppModal :title="`${game.title} · 播放器`" wide @close="emit('close')">
    <p class="local-note">示例作品尚未提供游戏包。选择本地 TCPAK，可在独立的真实引擎播放器中运行；不支持含 C# 的包。</p>
    <label class="field-label">打开 TCPAK 资源包<input type="file" accept=".tcpak" @change="choose" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="running" role="status">正在运行本地游戏包</p>
    <div v-if="bytes" class="runtime-player"><EngineSurface :key="generation" kind="player" :bytes="bytes" @ready="running = true" @error="error = $event; running = false" /></div>
    <div class="dialog-actions"><button class="button" @click="bytes = undefined; running = false">停止</button><button class="button button-primary" @click="emit('close')">关闭播放器</button></div>
  </AppModal>
</template>
<style scoped>.runtime-player{height:55vh;min-height:320px;margin-top:16px}input{display:block;margin:12px 0}</style>
