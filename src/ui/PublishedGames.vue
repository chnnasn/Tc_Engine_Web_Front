<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUpRight, Gamepad2, Play, RefreshCw, Search } from '@lucide/vue'
import { ArcadeError, listPublishedGames, type PublishedGame } from '../engine/arcade'
import AppLink from './AppLink.vue'
import SearchField from './SearchField.vue'

const props = withDefaults(defineProps<{ limit?: number; searchable?: boolean }>(), { searchable: false })
const games = ref<PublishedGame[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
let request = 0
const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const matches = games.value.filter(game => `${game.title} ${game.description}`.toLowerCase().includes(keyword))
  return props.limit ? matches.slice(0, props.limit) : matches
})
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
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
  <div class="published-games">
    <div class="published-controls">
      <SearchField v-if="searchable" v-model="query" placeholder="搜索玩家作品" />
      <span v-else class="published-order">最近发布 · 最多展示 {{ limit }} 件作品</span>
      <button class="button" :disabled="loading" @click="load"><RefreshCw :size="14" />刷新作品</button>
    </div>
    <div v-if="loading" class="published-state" role="status"><RefreshCw :size="23" /><strong>正在加载玩家作品…</strong></div>
    <div v-else-if="error" class="published-state" role="alert"><Gamepad2 :size="28" /><strong>玩家作品暂时无法加载</strong><p>{{ error }}</p><button class="button" @click="load">重试</button></div>
    <div v-else-if="!games.length" class="published-state published-empty"><span class="published-state-icon"><Gamepad2 :size="28" /></span><div><h3>还没有已发布的玩家作品</h3><p>在编辑器中保存并发布作品，让大家从这里发现你的世界。</p></div><AppLink href="/projects" class="button button-primary">去创作<ArrowUpRight :size="15" /></AppLink></div>
    <div v-else-if="!filtered.length" class="published-state"><Search :size="25" /><strong>没有找到匹配的玩家作品</strong><p>换个关键词，或查看全部已发布作品。</p><button class="button" @click="query = ''">清空搜索</button></div>
    <div v-else class="published-grid">
      <article v-for="game in filtered" :key="game.id" class="published-card">
        <div class="published-card-top"><span class="published-state-icon"><Gamepad2 :size="24" /></span><span class="small-tag">玩家作品</span></div>
        <h3>{{ game.title }}</h3><p>{{ game.description || '创作者还没有写下介绍。' }}</p>
        <div class="published-card-footer"><span>{{ formatDate(game.publishedAt) }} 发布</span><AppLink :href="`/play/${encodeURIComponent(game.id)}`" class="text-link"><Play :size="14" />打开游玩</AppLink></div>
      </article>
    </div>
  </div>
</template>
