<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Gamepad2, Play, RefreshCw } from '@lucide/vue'
import AppLink from './AppLink.vue'
import { ArcadeError, listPublishedGames, type PublishedGame } from '../engine/arcade'

const emit = defineEmits<{ notify: [message: string] }>()
const games = ref<PublishedGame[]>()
const error = ref('')
const loading = ref(false)
const query = ref('')
let request = 0

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!games.value) return undefined
  if (!keyword) return games.value
  return games.value.filter(game => game.title.toLowerCase().includes(keyword) || game.description.toLowerCase().includes(keyword))
})
function formatSize(byteLength: number) {
  if (byteLength >= 1024 * 1024) return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  if (byteLength >= 1024) return `${Math.round(byteLength / 1024)} KB`
  return `${byteLength} B`
}
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
async function load() {
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const list = await listPublishedGames()
    if (current === request) games.value = list
  } catch (cause) {
    if (current === request) error.value = cause instanceof ArcadeError ? cause.message : '无法加载玩家作品，请稍后重试'
  } finally { if (current === request) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { request++ })
</script>
<template>
  <main id="main-content" class="page arcade-page">
    <header class="arcade-heading">
      <div>
        <span class="detail-eyebrow"><span class="topic-category">玩家作品</span><span>创作者发布 · 云端游玩</span></span>
        <h1>玩家作品</h1>
        <p>这些作品由创作者在网页编辑器里完成并发布，打开即玩，无需安装。</p>
      </div>
      <div class="arcade-tools">
        <input v-model="query" class="text-input arcade-search" type="search" placeholder="搜索作品名称或介绍" aria-label="搜索玩家作品" />
        <button class="button" :disabled="loading" @click="load"><RefreshCw :size="15" />刷新</button>
      </div>
    </header>
    <p v-if="error" class="local-note" role="alert">{{ error }} <button class="button" @click="load">重试</button></p>
    <p v-else-if="loading && !filtered" class="local-note" role="status">正在加载玩家作品…</p>
    <div v-else-if="filtered && filtered.length" class="arcade-grid">
      <article v-for="game in filtered" :key="game.id" class="arcade-card">
        <div class="arcade-card-icon" aria-hidden="true"><Gamepad2 :size="26" /></div>
        <h2>{{ game.title }}</h2>
        <p>{{ game.description || '创作者还没有写下介绍。' }}</p>
        <div class="arcade-card-meta">
          <span>{{ formatSize(game.byteLength) }}</span>
          <span>{{ formatDate(game.publishedAt) }}</span>
        </div>
        <AppLink :href="`/play/${game.id}`" class="button button-primary arcade-play"><Play :size="15" />打开游玩</AppLink>
      </article>
    </div>
    <div v-else class="empty-arcade">
      <Gamepad2 :size="40" />
      <h2>还没有已发布的作品</h2>
      <p>在编辑器中完成创作，点击工具栏的“发布”，你的作品就会出现在这里，供所有人在线游玩。</p>
      <AppLink href="/projects" class="button">去创作</AppLink>
    </div>
  </main>
</template>
<style scoped>
.arcade-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.arcade-heading h1{margin:8px 0 6px;font-size:30px}
.arcade-heading p{margin:0;color:#5c6b60}
.arcade-tools{display:flex;gap:8px;align-items:center}
.arcade-search{min-width:220px}
.arcade-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.arcade-card{display:flex;flex-direction:column;gap:8px;padding:18px;border:1px solid #dfe5dc;border-radius:14px;background:#fbfcf8}
.arcade-card-icon{width:48px;height:48px;display:grid;place-content:center;border-radius:12px;background:#e8efdf;color:#4a6741}
.arcade-card h2{margin:4px 0 0;font-size:18px}
.arcade-card p{margin:0;flex:1;font-size:13px;color:#5c6b60;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.arcade-card-meta{display:flex;justify-content:space-between;font-size:12px;color:#8a968c}
.arcade-play{justify-content:center}
.empty-arcade{display:grid;place-items:center;gap:10px;padding:60px 20px;text-align:center;color:#4a6741;border:1px dashed #cdd8c4;border-radius:14px}
.empty-arcade h2{margin:0;font-size:20px;color:#24322b}
.empty-arcade p{margin:0;max-width:420px;color:#5c6b60}
</style>
