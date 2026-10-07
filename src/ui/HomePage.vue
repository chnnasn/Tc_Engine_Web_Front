<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, ArrowUpRight, MessageSquare, Sparkles } from '@lucide/vue'
import { games, initialTopics } from './data'
import AppLink from './AppLink.vue'
import ArtworkView from './ArtworkView.vue'
import EmptyState from './EmptyState.vue'
import GameCard from './GameCard.vue'
import SearchField from './SearchField.vue'
import TextLink from './TextLink.vue'
import PublishedGames from './PublishedGames.vue'
import HomeIntro from './HomeIntro.vue'

const props = defineProps<{ saved: string[] }>()
const emit = defineEmits<{ toggleSave: [id: string]; create: [] }>()
const category = ref('全部示例')
const query = ref('')
const categories = ['全部示例', '探索', '解谜', '冒险']

const filtered = computed(() => {
  const result = games.filter(game =>
    (category.value === '全部示例' || game.category === category.value) &&
    `${game.title} ${game.subtitle}`.toLowerCase().includes(query.value.trim().toLowerCase()))
  return result
})
</script>

<template>
  <main id="main-content" class="page home-page">
    <HomeIntro @create="emit('create')" />

    <section class="home-published" aria-labelledby="published-title">
      <div class="section-index"><span>MADE BY PLAYERS</span><span>创作者发布</span></div>
      <div class="section-heading"><div><h2 id="published-title">玩家作品</h2><p>最近发布推荐，发现正在发生的新创作。</p></div><TextLink href="/play">查看全部作品</TextLink></div>
      <PublishedGames :limit="6" />
    </section>

    <section class="discover-section" aria-labelledby="discover-title">
      <div class="section-index"><span>TRY THE ENGINE</span><span>{{ games.length }} 个内置示例</span></div>
      <div class="section-heading"><div><h2 id="discover-title">示例体验<span class="subtle-count">{{ games.length }}</span></h2><p>通过内置场景体验引擎，示例不计入玩家发布作品。</p></div></div>
    <section class="feature" aria-label="内置引擎示例">
      <div class="feature-copy">
        <div class="feature-label"><span class="feature-badge">示例体验</span><span class="feature-number">01 / {{ games.length.toString().padStart(2, '0') }}</span></div>
        <div><span class="feature-genre">探索 · 慢节奏 · 治愈</span><h2>林间来信</h2><p>沿着溪流，穿过森林。<br />把一封信，送到世界的小小角落。</p></div>
        <div class="feature-bottom"><AppLink class="button button-dark" href="/games/forest">探索这个世界<ArrowUpRight :size="17" /></AppLink><span>内置引擎示例</span></div>
      </div>
      <AppLink href="/games/forest" class="feature-art" aria-label="探索林间来信">
        <ArtworkView :src="games[0].image" alt="林间来信：红斗篷旅人在溪流与小屋之间漫步" eager />
        <span class="image-label"><span />一个值得慢下来的世界</span>
      </AppLink>
    </section>

      <div class="filter-bar">
        <div class="filter-tabs" aria-label="示例分类"><button v-for="item in categories" :key="item" :class="{ active: category === item }" :aria-pressed="category === item" @click="category = item">{{ item }}</button></div>
        <SearchField v-model="query" placeholder="搜索示例" />
      </div>
      <div v-if="filtered.length" class="game-grid"><GameCard v-for="game in filtered" :key="game.id" :game="game" :saved="props.saved.includes(game.id)" @toggle-save="emit('toggleSave', game.id)" /></div>
      <EmptyState v-else title="没有找到匹配的示例" text="换个关键词，或看看其他分类吧。"><button class="button" @click="query = ''; category = '全部示例'">查看全部示例</button></EmptyState>
    </section>

    <section class="home-bottom">
      <div class="community-preview">
        <div class="section-heading"><h2>社区界面演示</h2><TextLink href="/community">去社区逛逛</TextLink></div>
        <div class="compact-topics"><AppLink v-for="topic in initialTopics.slice(1, 4)" :key="topic.id" :href="`/community/${topic.id}`" class="compact-topic"><span class="topic-category">{{ topic.category }}</span><span class="compact-topic-title">{{ topic.title }}</span><span class="reply-count"><MessageSquare :size="14" />{{ topic.replies }}</span></AppLink></div>
      </div>
      <aside class="create-aside"><div class="aside-icon"><Sparkles :size="21" :stroke-width="1.5" /></div><h3>不止游玩，也来创造。</h3><p>给那个还没完成的想法，<br />一个开始的地方。</p><button class="text-link" @click="emit('create')">创建我的第一个项目<ArrowRight :size="17" /></button></aside>
    </section>
    <section class="home-faq" aria-labelledby="faq-title">
      <div><span class="eyebrow">BEFORE YOU START</span><h2 id="faq-title">开始之前，<br />你可能想知道。</h2></div>
      <div class="faq-items">
        <details><summary>需要下载或安装吗？<span>+</span></summary><p>游玩和编辑都在浏览器里完成。首次打开时需要加载引擎，请稍等片刻。可以先打开一个内置示例，看看效果。</p></details>
        <details><summary>AI 助手可以做些什么？<span>+</span></summary><p>打开自己的项目后，点击编辑器中的“AI 助手”。它可以读取场景、创建对象和修改支持的组件。每次任务会显示执行过程，完成后请检查场景并运行预览。</p></details>
        <details><summary>我的修改会自动保存吗？<span>+</span></summary><p>登录后，项目与云端关联。请留意编辑器的保存状态；AI 任务开始前和正常结束后会建立检查点。停止任务会保留已执行的修改，需要时可以撤销。</p></details>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-faq{display:grid;grid-template-columns:1fr 1.5fr;gap:72px;padding:65px 0 10px;margin-top:35px;border-top:1px solid #dfd8ce}.home-faq h2{font-family:Georgia,'Songti SC','SimSun',serif;font-size:31px;font-weight:500;line-height:1.5;margin-top:14px}.faq-items details{border-bottom:1px solid #dfd8ce}.faq-items summary{display:flex;justify-content:space-between;align-items:center;gap:20px;cursor:pointer;list-style:none;padding:23px 0;font-size:15px}.faq-items summary::-webkit-details-marker{display:none}.faq-items summary span{font-size:24px;font-weight:300;color:#8d8276;transition:transform .15s}.faq-items details[open] summary span{transform:rotate(45deg)}.faq-items p{padding:0 30px 24px 0;font-size:13px;color:#777066;line-height:1.9}.faq-items summary:focus-visible{outline:2px solid #a65036;outline-offset:4px}#discover-title{scroll-margin-top:110px}@media(max-width:700px){.home-faq{grid-template-columns:1fr;gap:18px;padding-top:35px}.home-faq h2{font-size:26px}.home-faq h2 br{display:none}}@media(prefers-reduced-motion:reduce){.faq-items summary span{transition:none}}
</style>
