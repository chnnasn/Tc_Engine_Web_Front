<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, TriangleAlert } from '@lucide/vue'
import AppLink from './AppLink.vue'
import EngineSurface from './EngineSurface.vue'
import { ArcadeError, engineCompatibility, loadPublishedPackage, publishedGame, type PublishedGame } from '../engine/arcade'

const props = defineProps<{ gameId: string }>()
const emit = defineEmits<{ notify: [message: string] }>()
const game = ref<PublishedGame>()
const bytes = ref<Uint8Array>()
const loading = ref(true)
const error = ref('')
const running = ref(false)
const controller = new AbortController()

const compatibility = computed(() => game.value ? engineCompatibility(game.value.engineCommit) : 'match')
const warning = computed(() => {
  if (compatibility.value === 'match') return ''
  const commit = game.value?.engineCommit.slice(0, 7) ?? ''
  return compatibility.value === 'legacy'
    ? `此作品由旧引擎版本（${commit}）打包，可能无法在当前播放器中运行。`
    : `此作品由其他引擎版本（${commit}）打包，与当前播放器可能不兼容。`
})

async function load() {
  loading.value = true
  error.value = ''
  bytes.value = undefined
  running.value = false
  try {
    game.value = await publishedGame(props.gameId)
    // 先取详情再下载大包：404 / 元数据错误不必等完整下载。
    bytes.value = await loadPublishedPackage(props.gameId, controller.signal)
  } catch (cause) {
    error.value = cause instanceof ArcadeError ? cause.message : '作品加载失败，请稍后重试'
  } finally { loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => controller.abort())
</script>
<template>
  <main id="main-content" class="page play-page">
    <AppLink href="/play" class="back-link"><ArrowLeft :size="15" />返回玩家作品</AppLink>
    <p v-if="loading" class="local-note" role="status">正在加载作品与游戏包…</p>
    <div v-else-if="error" class="empty-arcade" role="alert">
      <TriangleAlert :size="36" />
      <h2>无法打开这个作品</h2>
      <p>{{ error }}</p>
      <button class="button" @click="load">重试</button>
    </div>
    <template v-else-if="game">
      <header class="play-heading">
        <div>
          <h1>{{ game.title }}</h1>
          <p>{{ game.description || '创作者还没有写下介绍。' }}</p>
        </div>
      </header>
      <p v-if="warning" class="local-note" role="alert"><TriangleAlert :size="15" /> {{ warning }}</p>
      <p v-if="running" class="local-note" role="status">作品正在运行，Esc 无法退出；关闭页面即可结束。</p>
      <div v-if="bytes" class="play-surface">
        <EngineSurface kind="player" :bytes="bytes" @ready="running = true" @error="error = $event; running = false" />
      </div>
      <div v-else class="local-note">正在下载游戏包…</div>
    </template>
  </main>
</template>
<style scoped>
.play-page{display:flex;flex-direction:column;gap:14px}
.play-heading h1{margin:0 0 6px;font-size:26px}
.play-heading p{margin:0;color:#5c6b60}
.play-surface{height:min(68vh,720px);border:1px solid #dfe5dc;border-radius:14px;overflow:hidden;background:#202329}
.play-heading + .local-note{display:flex;align-items:center;gap:6px}
.empty-arcade{display:grid;place-items:center;gap:10px;padding:60px 20px;text-align:center;color:#a04b32;border:1px dashed #e0c6ba;border-radius:14px}
.empty-arcade h2{margin:0;font-size:20px;color:#24322b}
.empty-arcade p{margin:0;max-width:420px;color:#5c6b60}
</style>
