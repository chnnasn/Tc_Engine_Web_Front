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
    <div class="editorial-heading"><div class="page-intro">
      <span class="eyebrow"><span class="live-dot" />TOMCAT / PLAY & CREATE</span>
      <h1>发现游戏，<br class="mobile-break" />也发现可能<span class="green-dot">.</span></h1>
      <p>打开一个新世界，或者亲手创造下一个。</p>
    </div><div class="editorial-note"><span>为好奇心而造</span><p>即刻游玩 · 自由创作</p><button class="text-link" @click="emit('create')">进入创作工作台 <ArrowUpRight :size="16" /></button></div></div>

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
  </main>
</template>
