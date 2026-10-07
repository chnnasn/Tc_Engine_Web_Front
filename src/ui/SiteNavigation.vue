<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUpRight, ChevronDown, Menu, X } from '@lucide/vue'
import AppLink from './AppLink.vue'

const props = defineProps<{ path: string }>()
const emit = defineEmits<{ create: [] }>()
const area = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const mobileTrigger = ref<HTMLButtonElement>()
const expanded = ref(false)
const mobile = ref(false)
function close() { expanded.value = false; mobile.value = false }
function outside(event: PointerEvent) { if (!area.value?.contains(event.target as Node)) close() }
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (expanded.value) { expanded.value = false; trigger.value?.focus() }
  else if (mobile.value) { mobile.value = false; mobileTrigger.value?.focus() }
}
watch(() => props.path, close)
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="area" class="site-navigation" @keydown="escape" @focusout="(event) => { if (!area?.contains(event.relatedTarget as Node)) close() }">
    <button ref="mobileTrigger" class="nav-mobile-toggle" :aria-expanded="mobile" aria-controls="site-navigation-links" :aria-label="mobile ? '收起导航' : '展开导航'" @click="mobile = !mobile"><X v-if="mobile" :size="21" /><Menu v-else :size="21" /></button>
    <nav id="site-navigation-links" class="navigation-links" :class="{ 'mobile-open': mobile }" aria-label="主导航">
      <AppLink href="/" :aria-current="path === '/' || path.startsWith('/games') ? 'page' : undefined" @click="close">发现游戏</AppLink>
      <AppLink href="/play" :aria-current="path.startsWith('/play') ? 'page' : undefined" @click="close">玩家作品</AppLink>
      <div class="nav-disclosure">
        <button ref="trigger" class="nav-disclosure-trigger" :aria-expanded="expanded" aria-controls="create-navigation" @click="expanded = !expanded">创作 <ChevronDown :size="14" /></button>
        <div v-if="expanded" id="create-navigation" class="nav-flyout">
          <span class="nav-caption">把想法变成可以玩的东西</span>
          <button @click="close(); emit('create')"><span><strong>开始一个新项目</strong><small>从基础场景或一张白纸开始</small></span><ArrowUpRight :size="18" /></button>
          <AppLink href="/projects" @click="close"><span><strong>我的项目</strong><small>回到你的工作台，继续创作</small></span><ArrowUpRight :size="18" /></AppLink>
          <p>在编辑器中打开 AI 助手，用文字描述场景修改。</p>
        </div>
      </div>
      <AppLink href="/community" :aria-current="path.startsWith('/community') ? 'page' : undefined" @click="close">社区</AppLink>
    </nav>
  </div>
</template>

<style scoped>
.site-navigation{position:relative}.navigation-links{display:flex;gap:7px;align-items:center}.navigation-links>a,.nav-disclosure-trigger{display:flex;align-items:center;gap:6px;border:0;background:transparent;padding:10px 13px;border-radius:7px;font-size:13px;color:#57534b;white-space:nowrap}.navigation-links>a:hover,.nav-disclosure-trigger:hover,.nav-disclosure-trigger[aria-expanded=true]{background:#eae7df;color:#24221e}.navigation-links>a[aria-current=page]{color:#a65036}.nav-disclosure-trigger svg{transition:transform .18s}.nav-disclosure-trigger[aria-expanded=true] svg{transform:rotate(180deg)}.nav-disclosure{position:relative}.nav-flyout{position:absolute;top:calc(100% + 14px);left:-30px;width:330px;padding:22px;background:#fcfbf8;border:1px solid #dedbd2;box-shadow:0 14px 32px #30292212;border-radius:14px;animation:nav-enter .16s ease-out}.nav-caption{font-size:11px;color:#827b72}.nav-flyout a,.nav-flyout button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;border:0;background:transparent;text-align:left;padding:16px 10px;margin-top:8px;border-radius:8px}.nav-flyout a:hover,.nav-flyout button:hover{background:#efece4}.nav-flyout strong{display:block;font-size:14px;font-weight:550}.nav-flyout small{display:block;font-size:12px;color:#777066;margin-top:4px}.nav-flyout p{border-top:1px solid #e3dfd7;padding-top:15px;margin-top:10px;font-size:12px;line-height:1.8;color:#777066}.nav-mobile-toggle{display:none}.nav-flyout svg{color:#a65036}@keyframes nav-enter{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.nav-mobile-toggle{display:grid;place-items:center;width:38px;height:38px;border:1px solid #dfd8ce;border-radius:8px;background:transparent}.navigation-links{display:none}.navigation-links.mobile-open{display:flex;position:fixed;left:16px;right:16px;top:72px;max-height:calc(100dvh - 90px);overflow:auto;background:#fcfbf8;border:1px solid #dedbd2;border-radius:14px;padding:14px;box-shadow:0 16px 32px #30292215;align-items:stretch;flex-direction:column}.navigation-links>a,.nav-disclosure-trigger{width:100%;padding:13px;font-size:15px;justify-content:space-between}.nav-flyout{position:static;width:100%;box-shadow:none;margin-top:6px;background:#f3f0e9;padding:16px}.site-navigation{order:3}}
@media(prefers-reduced-motion:reduce){.nav-flyout{animation:none}.nav-disclosure-trigger svg{transition:none}}
</style>
