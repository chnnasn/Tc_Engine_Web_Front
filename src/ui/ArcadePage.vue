<script setup lang="ts">
import PublishedGames from './PublishedGames.vue'
</script>

<template>
  <main id="main-content" class="page arcade-page">
    <div class="page-intro"><span class="eyebrow">MADE BY PLAYERS</span><h1>玩家作品<span class="green-dot">.</span></h1><p>发现创作者真正发布的世界，按最近发布时间排列，打开即玩。</p></div>
    <PublishedGames searchable />
  </main>
</template>
