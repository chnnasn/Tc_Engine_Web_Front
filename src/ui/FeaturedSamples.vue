<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from '@lucide/vue'
import type { Game } from './data'
import AppLink from './AppLink.vue'
import ArtworkView from './ArtworkView.vue'

const props = defineProps<{ games: Game[] }>()
const index = ref(0)
const featured = computed(() => props.games[index.value]!)
const section = ref<HTMLElement>()
const desktop = ref(false), reducedMotion = ref(false), paused = ref(false)
const hovered = ref(false), focused = ref(false), visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | undefined
let screen: MediaQueryList, motion: MediaQueryList
const blurbs: Record<string, string> = {
  return: '切换生死世界，推动箱子、压住按钮。包含教学关、五个关卡与最终场景。',
  shelter: '派遣居民收集资源，建设农场与城墙。在一场场风暴中，守住避难所。',
  rougelike: '走位、挥刀、选择强化，在十波敌人的围攻中找到自己的节奏。',
  'physics-lab': '四个方块自由落下，与地面碰撞、旋转、停稳。直接观察真实的 2D 物理模拟。',
}
function schedule() {
  clearTimeout(timer)
  if (desktop.value && !reducedMotion.value && !paused.value && !hovered.value && !focused.value && visible.value && !document.hidden && props.games.length > 1) {
    timer = setTimeout(() => { index.value = (index.value + 1) % props.games.length }, 6000)
  }
}
function select(next: number) { index.value = (next + props.games.length) % props.games.length; schedule() }
function mediaChanged() { desktop.value = screen.matches; reducedMotion.value = motion.matches; schedule() }
function focusOut(event: FocusEvent) { focused.value = !!event.relatedTarget && !!section.value?.contains(event.relatedTarget as Node) }
watch([index, paused, hovered, focused, visible], schedule)
onMounted(() => {
  screen = matchMedia('(min-width: 761px)'); motion = matchMedia('(prefers-reduced-motion: reduce)')
  screen.addEventListener('change', mediaChanged); motion.addEventListener('change', mediaChanged)
  document.addEventListener('visibilitychange', schedule)
  mediaChanged()
  observer = new IntersectionObserver(entries => { visible.value = entries[0]?.isIntersecting ?? false }, { threshold: .2 })
  if (section.value) observer.observe(section.value)
})
onBeforeUnmount(() => {
  clearTimeout(timer); observer?.disconnect()
  screen?.removeEventListener('change', mediaChanged); motion?.removeEventListener('change', mediaChanged)
  document.removeEventListener('visibilitychange', schedule)
})
</script>

<template>
  <section ref="section" class="sample-carousel" aria-label="精选引擎示例" aria-roledescription="轮播" :data-game-id="featured.id"
    @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focused = true" @focusout="focusOut">
    <div class="feature">
      <div class="feature-copy">
        <div class="feature-label"><span class="feature-badge">Tc 引擎示例 · 实际运行截图</span><span class="feature-number">{{ String(index + 1).padStart(2, '0') }} / {{ String(games.length).padStart(2, '0') }}</span></div>
        <div class="sample-copy"><span class="feature-genre">{{ featured.category }} · 浏览器直接体验</span><h2>{{ featured.title.split(' · ')[0] }}<span class="sample-subtitle">{{ featured.title.split(' · ')[1] }}</span></h2><p>{{ blurbs[featured.id] || featured.subtitle }}</p></div>
        <div class="feature-bottom"><AppLink class="button button-dark" :href="`/games/${featured.id}`" :aria-label="`体验 ${featured.title}`">立即体验<ArrowUpRight :size="17" /></AppLink><span>{{ featured.controls ? '桌面键盘 / 鼠标' : '自动物理演示' }}</span></div>
      </div>
      <AppLink :href="`/games/${featured.id}`" class="feature-art" :aria-label="`查看 ${featured.title} 实际画面`">
        <ArtworkView :key="featured.id" :src="featured.image" :alt="`${featured.title}实际运行截图`" eager />
        <span class="image-label"><span />{{ featured.subtitle }}</span>
      </AppLink>
    </div>
    <div class="carousel-controls">
      <div class="carousel-choices" aria-label="切换精选示例"><button v-for="(game, n) in games" :key="game.id" :aria-pressed="index === n" :aria-label="`展示 ${game.title}`" @click="select(n)"><span class="choice-dot" />{{ game.title.split(' · ')[1] || game.title }}</button></div>
      <div class="carousel-actions"><button class="icon-button" aria-label="上一个示例" @click="select(index - 1)"><ArrowLeft :size="17" /></button><button class="icon-button" aria-label="下一个示例" @click="select(index + 1)"><ArrowRight :size="17" /></button><button v-if="desktop && !reducedMotion" class="rotation-button" :aria-label="paused ? '开启自动轮播' : '暂停自动轮播'" :aria-pressed="paused" @click="paused = !paused"><Play v-if="paused" :size="14" /><Pause v-else :size="14" />{{ paused ? '继续轮播' : '自动轮播' }}</button></div>
    </div>
  </section>
</template>

<style scoped>
.sample-carousel{margin-bottom:36px}.sample-carousel .feature{margin-bottom:0;min-height:400px;background:#eee7db}.feature-copy{min-width:0}.sample-copy{min-height:210px}.sample-subtitle{display:block;margin-top:8px;font-size:.7em;letter-spacing:.05em}.feature-art{background:#1d212d}.feature-art :deep(img){width:100%;height:100%;object-fit:contain!important;transform:none!important}.image-label{background:#172527e6;color:#f0f2f6;max-width:calc(100% - 36px)}.carousel-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 5px}.carousel-choices,.carousel-actions{display:flex;align-items:center;gap:10px}.carousel-choices{flex-wrap:wrap}.carousel-choices button,.rotation-button{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;color:#7c7367;padding:8px;font-size:12px;cursor:pointer}.carousel-choices button[aria-pressed=true]{color:#39342c;font-weight:600}.choice-dot{width:6px;height:6px;border-radius:50%;background:#c8bfae}.carousel-choices button[aria-pressed=true] .choice-dot{background:#a65036}.rotation-button{white-space:nowrap}.carousel-actions{flex-shrink:0}.sample-carousel button:focus-visible{outline:2px solid #a65036;outline-offset:3px}@media(max-width:760px){.sample-carousel .feature{grid-template-columns:1fr}.sample-copy{min-height:0}.sample-carousel .feature-art{min-height:0;aspect-ratio:16/10}.carousel-controls{align-items:flex-start}.carousel-choices{gap:0}.carousel-choices button{font-size:11px;padding:7px}.carousel-actions{gap:2px}.image-label{font-size:10px}.feature-copy{padding:24px}.feature-art :deep(img){object-fit:contain!important}}
</style>
