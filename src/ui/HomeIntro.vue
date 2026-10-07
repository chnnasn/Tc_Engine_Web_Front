<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Layers, MousePointer2, Play, Plus } from '@lucide/vue'
import AppLink from './AppLink.vue'
import ArtworkView from './ArtworkView.vue'
import { games } from './data'

const emit = defineEmits<{ create: [] }>()
const mode = ref<'play' | 'create'>('play')
const selected = ref(0)
const sample = computed(() => games[selected.value])
const step = ref(0)
const steps = [
  { title: '放下第一个对象', description: '在场景里添加角色，为你的游戏选一个起点。' },
  { title: '和 AI 一起修改', description: '说明想改什么，查看执行过程，再检查实际场景。' },
  { title: '按下运行，看看效果', description: '在编辑器里预览，准备好后再发布作品。' },
]
function chooseMode(next: 'play' | 'create') { mode.value = next }
function switchTab(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  chooseMode(event.key === 'Home' ? 'play' : event.key === 'End' ? 'create' : mode.value === 'play' ? 'create' : 'play')
  const parent = (event.currentTarget as HTMLElement).parentElement
  ;(parent?.querySelector(`#intro-tab-${mode.value}`) as HTMLElement)?.focus()
}
function explore() { document.getElementById('discover-title')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) }
</script>

<template>
  <section class="home-intro" aria-labelledby="intro-title">
    <div class="intro-copy">
      <span class="intro-kicker">TC FUN · 给好玩的想法一个开始</span>
      <h1 id="intro-title">有个想法？<br />让它<span>玩起来。</span></h1>
      <p class="intro-lead">从一场小小的冒险，<br />到一个属于你的世界。</p>
      <div class="intro-switch" role="tablist" aria-label="选择体验方式">
        <button v-for="tab in (['play', 'create'] as const)" :id="`intro-tab-${tab}`" :key="tab" role="tab" :aria-selected="mode === tab" :tabindex="mode === tab ? 0 : -1" aria-controls="intro-experience" @click="chooseMode(tab)" @keydown="switchTab">{{ tab === 'play' ? '先玩一会儿' : '开始创作' }}</button>
      </div>
      <div class="intro-action">
        <template v-if="mode === 'play'"><AppLink class="button button-dark" :href="`/games/${sample.id}`">打开{{ sample.title }} <ArrowUpRight :size="17" /></AppLink><span>无需下载 · 从内置示例开始</span></template>
        <template v-else><button class="button button-dark" @click="emit('create')">创建我的项目 <Plus :size="17" /></button><span>登录后创作 · 项目保存到云端</span></template>
      </div>
    </div>

    <div id="intro-experience" class="intro-experience" role="tabpanel" :aria-labelledby="`intro-tab-${mode}`" tabindex="0">
      <Transition name="experience" mode="out-in">
        <div v-if="mode === 'play'" key="play" class="intro-play">
          <AppLink :href="`/games/${sample.id}`" class="intro-art" :aria-label="`体验${sample.title}`"><ArtworkView :src="sample.image" :alt="sample.title" eager /><span class="intro-play-button"><Play :size="18" fill="currentColor" /> 即刻体验</span></AppLink>
          <div class="intro-game-caption"><span><small>内置引擎示例 / {{ String(selected + 1).padStart(2, '0') }}</small><strong>{{ sample.title }}</strong></span><span>{{ sample.category }} <ArrowUpRight :size="17" /></span></div>
          <div class="intro-samples" aria-label="选择示例"><button v-for="(game, index) in games" :key="game.id" :aria-pressed="selected === index" @click="selected = index">{{ game.title }}</button></div>
        </div>
        <div v-else key="create" class="intro-create">
          <div class="preview-topline"><span><Layers :size="14" /> 我的第一个游戏</span><span>交互预览</span></div>
          <div class="scene-sketch" :class="`scene-step-${step}`" aria-hidden="true"><span class="sketch-axis axis-x" /><span class="sketch-axis axis-y" /><div class="sketch-platform" /><div class="sketch-player"><span>Player</span></div><MousePointer2 class="sketch-cursor" :size="27" /><div v-if="step === 1" class="sketch-message">把 Player 向右移动一点 <Check :size="15" /></div><span v-if="step === 2" class="sketch-running"><Play :size="12" fill="currentColor" /> 预览中</span></div>
          <div class="intro-step-copy" aria-live="polite"><strong>{{ steps[step].title }}</strong><p>{{ steps[step].description }}</p></div>
          <div class="intro-steps" aria-label="创作流程"><button v-for="(label, index) in ['添加对象', 'AI 修改', '运行预览']" :key="label" :aria-pressed="step === index" @click="step = index"><span>{{ index + 1 }}</span>{{ label }}<ArrowRight v-if="index < 2" :size="13" /></button></div>
        </div>
      </Transition>
    </div>
    <button class="intro-scroll" @click="explore">往下看看，有什么好玩的 <ArrowDown :size="15" /></button>
  </section>
</template>

<style scoped>
.home-intro{display:grid;grid-template-columns:1fr 1.1fr;column-gap:72px;row-gap:32px;padding:30px 0 58px;align-items:center}.intro-kicker{font-size:11px;letter-spacing:2px;color:#776e64}.intro-copy h1{font-family:Georgia,'Songti SC','SimSun',serif;font-size:clamp(44px,5.2vw,72px);font-weight:500;letter-spacing:-2px;line-height:1.28;margin:24px 0}.intro-copy h1 span{color:#a65036}.intro-lead{font-size:17px;line-height:1.9;color:#777066}.intro-switch{display:inline-flex;border:1px solid #ded9d0;border-radius:10px;padding:4px;margin:29px 0 20px;gap:4px;background:#eeece5}.intro-switch button{border:0;background:transparent;color:#777066;border-radius:7px;padding:9px 19px;font-size:13px}.intro-switch button[aria-selected=true]{background:#fffdf9;color:#302a24;box-shadow:0 1px 4px #30292210}.intro-action{display:flex;flex-direction:column;align-items:flex-start;gap:12px;min-height:85px}.intro-action .button{padding:12px 24px;min-height:48px}.intro-action>span{font-size:11px;color:#777066}.intro-experience{min-width:0;border:1px solid #ded9d0;border-radius:20px;background:#eeece5;overflow:hidden;box-shadow:0 16px 45px #3e332a07}.intro-play{padding:12px}.intro-art{display:block;position:relative;height:310px;overflow:hidden;border-radius:12px}.intro-art :deep(img){width:100%;height:100%;object-fit:cover;transition:transform .5s}.intro-art:hover :deep(img){transform:scale(1.025)}.intro-play-button{position:absolute;left:20px;bottom:20px;display:flex;align-items:center;gap:8px;background:#fcfbf8ed;padding:10px 15px;border-radius:7px;font-size:12px}.intro-game-caption{display:flex;align-items:center;justify-content:space-between;padding:20px 12px 17px}.intro-game-caption small{display:block;font-size:10px;color:#777066;letter-spacing:1px}.intro-game-caption strong{display:block;font-size:23px;font-weight:500;margin-top:4px}.intro-game-caption>span:last-child{display:flex;gap:12px;font-size:12px;color:#777066}.intro-samples{display:flex;border-top:1px solid #ddd7ce;padding:12px 6px 1px;gap:6px}.intro-samples button{flex:1;padding:8px 3px;border:0;border-radius:6px;background:transparent;color:#777066;font-size:12px}.intro-samples button[aria-pressed=true]{background:#fcfbf8;color:#a65036}.intro-samples button:hover{background:#fcfbf8}.intro-scroll{grid-column:1/-1;justify-self:center;display:flex;align-items:center;gap:12px;padding:10px;background:transparent;border:0;color:#817a70;font-size:11px;margin-top:8px}.intro-scroll:hover{color:#a65036}.intro-create{padding:22px}.preview-topline{display:flex;align-items:center;justify-content:space-between;color:#7a746a;font-size:10px;gap:12px}.preview-topline>span:first-child{display:flex;align-items:center;gap:6px}.scene-sketch{position:relative;height:247px;background-image:linear-gradient(#d9d5ca65 1px,transparent 1px),linear-gradient(90deg,#d9d5ca65 1px,transparent 1px);background-size:24px 24px;margin:20px 0;overflow:hidden;border-radius:8px}.sketch-platform{position:absolute;bottom:49px;left:14%;width:72%;height:18px;background:#8c9682;border:1px solid #737e68;border-radius:4px}.sketch-player{position:absolute;bottom:68px;left:38%;width:44px;height:62px;background:#be7357;border:1px solid #9e513b;border-radius:20px 20px 6px 6px;outline:1px dashed #a65036;outline-offset:6px;transition:transform .5s}.sketch-player span{position:absolute;top:-32px;font:11px ui-monospace,monospace;color:#766b60}.scene-step-1 .sketch-player{transform:translateX(38px)}.scene-step-2 .sketch-player{transform:translate(68px,-26px);outline:0}.sketch-axis{position:absolute;background:#a59d9170}.axis-x{left:8%;right:8%;bottom:47px;height:1px}.axis-y{top:22px;bottom:25px;left:50%;width:1px}.sketch-cursor{position:absolute;left:52%;bottom:102px;color:#423a32;fill:#fcfbf8}.scene-step-2 .sketch-cursor{display:none}.sketch-message{position:absolute;top:18px;left:8%;right:8%;padding:12px;background:#fffdf9;border:1px solid #ddd7ce;border-radius:9px;font-size:11px;display:flex;justify-content:space-between;color:#6d6256}.sketch-message svg{color:#708567}.sketch-running{position:absolute;right:12px;top:12px;display:flex;align-items:center;gap:5px;font-size:11px;color:#577049}.intro-step-copy{min-height:71px}.intro-step-copy strong{font-size:20px;font-weight:500}.intro-step-copy p{margin-top:6px;font-size:12px;color:#777066;line-height:1.8}.intro-steps{display:flex;gap:8px;border-top:1px solid #ddd7ce;padding-top:16px;margin-top:14px}.intro-steps button{display:flex;align-items:center;gap:6px;font-size:11px;background:transparent;border:0;padding:5px 0;color:#777066;flex:1;white-space:nowrap}.intro-steps button span{border:1px solid #cfc7bb;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:10px}.intro-steps button[aria-pressed=true]{color:#a65036}.intro-steps button[aria-pressed=true] span{background:#a65036;color:white;border-color:#a65036}.intro-steps button svg{margin-left:auto}.experience-enter-active,.experience-leave-active{transition:opacity .13s,transform .13s}.experience-enter-from,.experience-leave-to{opacity:0;transform:translateY(5px)}
@media(max-width:1100px){.home-intro{column-gap:32px}.intro-art{height:280px}.intro-create{padding:16px}.intro-steps{gap:5px}}
@media(max-width:700px){.home-intro{grid-template-columns:1fr;padding-top:10px;gap:28px}.intro-copy{text-align:center}.intro-copy h1{font-size:48px;margin:20px 0}.intro-lead{font-size:15px}.intro-lead br{display:none}.intro-action{align-items:center}.intro-experience{width:100%;max-width:520px;justify-self:center}.intro-art{height:260px}.intro-scroll{margin-top:0}.intro-kicker{font-size:10px}.intro-steps{gap:10px}}
@media(prefers-reduced-motion:reduce){.experience-enter-active,.experience-leave-active,.sketch-player,.intro-art :deep(img){transition:none}}
</style>
