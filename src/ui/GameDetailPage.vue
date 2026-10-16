<script setup lang="ts">
import { useAccess } from './access'
import { ref } from 'vue'
import { ArrowLeft, Bookmark, Gamepad2, Play, Send } from '@lucide/vue'
import { isComments, uid, type Game, type LocalComment } from './data'
import { useLocalState } from './local-state'
import AppLink from './AppLink.vue'
import ArtworkView from './ArtworkView.vue'
import PlayerPreview from './PlayerPreview.vue'
import TextLink from './TextLink.vue'

const { user, requireLogin, openLogin } = useAccess()
const props = defineProps<{ game: Game; saved: boolean }>()
const emit = defineEmits<{ toggleSave: []; notify: [message: string] }>()
const player = ref(false)
const comment = ref('')
const { state: comments, storageError } = useLocalState<LocalComment[]>(`tomcat-ui-comments-${props.game.id}`, [], isComments)

async function submitComment() {
  if (!await requireLogin()) return
  if (!comment.value.trim()) return
  comments.value = [...comments.value, { id: uid(), text: comment.value.trim() }]
  comment.value = ''
  emit('notify', '留言已保存在此浏览器')
}
</script>

<template>
  <main id="main-content" class="page detail-page">
    <AppLink href="/" class="back-link"><ArrowLeft :size="15" />发现游戏</AppLink>
    <div class="detail-heading"><div><div class="detail-eyebrow"><span class="topic-category">{{ game.category }}</span><span>示例体验 · 内置引擎场景</span></div><h1>{{ game.title }}</h1><p>{{ game.subtitle }}</p></div><button class="button" :class="{ 'saved-button': saved }" :aria-pressed="saved" @click="emit('toggleSave')"><Bookmark :size="16" :fill="saved ? 'currentColor' : 'none'" />{{ saved ? '已收藏' : '收藏作品' }}</button></div>
    <div class="detail-layout">
      <div>
        <div class="detail-cover"><ArtworkView :src="game.image" :alt="`${game.title}游戏场景`" eager /><button class="cover-preview-button" @click="player = true"><Play :size="15" />{{ game.packageUrl ? '开始游玩' : '查看游玩界面' }}</button></div>
        <section class="content-section"><h2>关于这个示例</h2><p>{{ game.description }}</p><div class="game-tags"><span>{{ game.category }}</span><span>单人体验</span><span>中文</span><span>浏览器游戏</span></div></section>
        <section v-if="game.controls?.length" class="content-section" aria-labelledby="controls-title">
          <h2 id="controls-title">操作说明</h2><p>请使用桌面浏览器与键盘鼠标。进入后点击游戏画面，即可开始操作。</p>
          <dl class="game-controls"><div v-for="control in game.controls" :key="control.key"><dt><kbd>{{ control.key }}</kbd></dt><dd>{{ control.action }}</dd></div></dl>
        </section>
        <section class="content-section comment-section">
          <div class="section-heading"><h2>留下你的想法<span class="subtle-count">{{ comments.length }}</span></h2><span class="muted-small">本地留言</span></div>
          <p class="comment-intro">一句感受，一个建议，都是创作者继续前行的动力。</p>
          <button v-if="!user" class="button button-primary" @click="openLogin">登录后参与讨论</button><form v-else @submit.prevent="submitComment"><label class="sr-only" for="game-comment">你的留言</label><textarea id="game-comment" v-model="comment" class="text-input" maxlength="500" required placeholder="你喜欢这个世界里的哪一个瞬间？" /><div class="comment-form-footer"><span>{{ comment.length }} / 500</span><button class="button button-primary" :disabled="!comment.trim()"><Send :size="15" />留下想法</button></div></form>
          <p v-if="storageError" class="danger-text" role="alert">留言无法保存，浏览器存储不可用。</p>
          <div v-for="item in comments" :key="item.id" class="comment"><span class="avatar">M</span><div><strong>我<span>刚刚 · 本地</span></strong><p>{{ item.text }}</p></div></div>
        </section>
      </div>
      <aside class="detail-sidebar">
        <div class="play-panel"><span class="small-tag">内置示例</span><h3>{{ game.controls ? '准备迎接下一波？' : '准备好出发了吗？' }}</h3><p>{{ game.controls ? '走进竞技场，试试你的反应与选择。' : '打开一个新世界，给自己一点游玩的时间。' }}</p><button class="button button-primary" @click="player = true"><Play :size="16" fill="currentColor" />{{ game.packageUrl ? '开始游玩' : '打开游玩预览' }}</button><span class="play-footnote">{{ game.controls ? '桌面键盘 / 鼠标 · 首次加载请稍候' : '点击即可游玩，首次加载请稍候' }}</span><div class="play-stats"><span><Gamepad2 :size="15" />{{ game.category }}示例</span><span>浏览器直接体验</span></div></div>
        <div class="creator-panel"><span class="creator-avatar"><Gamepad2 :size="23" /></span><div><span>内置内容</span><strong>{{ game.packageUrl ? 'Tc 引擎复原示例' : '引擎示例体验' }}</strong></div><p>用于体验引擎与游玩流程，<br />不计入玩家发布作品。</p><TextLink v-if="!game.packageUrl" :href="game.id === 'puzzle' ? '/community/first-puzzle' : game.id === 'desert' ? '/community/weekend' : '/community/forest-devlog'">查看示例话题</TextLink></div>
        <div class="detail-facts"><div><span>游玩方式</span><span>{{ game.controls ? '桌面浏览器 · 键鼠' : '浏览器' }}</span></div><div><span>支持语言</span><span>简体中文</span></div><div><span>作品状态</span><span>示例作品</span></div></div>
        <a v-if="game.sourceUrl" class="button" :href="game.sourceUrl" download>下载 Tc 示例工程</a>
      </aside>
    </div>
    <PlayerPreview v-if="player" :game="game" @close="player = false" />
  </main>
</template>
<style scoped>
.game-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 22px;margin-top:20px}.game-controls>div{display:flex;align-items:center;gap:10px;font-size:12px}.game-controls dt{flex-shrink:0}.game-controls dd{margin:0;color:#756d63}.game-controls kbd{display:inline-block;padding:5px 8px;border:1px solid #e2ddd5;border-radius:5px;background:#faf8f4;font:11px ui-monospace,monospace;color:#514b43}@media(max-width:700px){.game-controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}
</style>
