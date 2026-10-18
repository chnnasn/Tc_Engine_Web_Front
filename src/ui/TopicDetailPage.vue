<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, MessageSquare, Send } from '@lucide/vue'
import { useAccess } from './access'
import type { Topic } from './data'
import { getTopic, listReplies, createReply, communityTime, type Reply } from './community-api'
import AppLink from './AppLink.vue'
import UserIdentity from './UserIdentity.vue'
import InlineModeration from './InlineModeration.vue'
import { useNavigation } from './navigation'

const { user, requireLogin, openLogin } = useAccess()
const props = defineProps<{ topicId: string }>()
const emit = defineEmits<{ notify: [message: string] }>()
const navigate = useNavigation()
async function removedReply() {
  emit('notify', '回复已删除')
  try { await loadReplies(Math.min(offset.value, Math.max(0, Math.floor((total.value - 2) / 50) * 50))) }
  catch (cause) { replyError.value = cause instanceof Error ? cause.message : '回复加载失败' }
}
function removedTopic() { emit('notify', '话题及回复已删除'); navigate('/community') }
const topic = ref<Topic>()
const replies = ref<Reply[]>([])
const total = ref(0)
const offset = ref(0)
const reply = ref('')
const error = ref('')
const replyError = ref('')
const loading = ref(false)
const sending = ref(false)
async function loadReplies(next = offset.value) {
  const page = await listReplies(props.topicId, next)
  replies.value = page.items; total.value = page.total; offset.value = next
}
async function load() {
  loading.value = true; error.value = ''
  try { topic.value = await getTopic(props.topicId); await loadReplies() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '话题加载失败' }
  finally { loading.value = false }
}
async function pageReplies(next: number) {
  loading.value = true; replyError.value = ''
  try { await loadReplies(next) } catch (cause) { replyError.value = cause instanceof Error ? cause.message : '回复加载失败' }
  finally { loading.value = false }
}
async function submitReply() {
  if (sending.value || !reply.value.trim() || !await requireLogin()) return
  sending.value = true; replyError.value = ''
  try {
    await createReply(props.topicId, reply.value.trim())
    reply.value = ''; emit('notify', '回复已发布')
    await loadReplies(Math.floor(total.value / 50) * 50)
  } catch (cause) { replyError.value = cause instanceof Error ? cause.message : '回复发布失败' }
  finally { sending.value = false }
}
onMounted(load)
</script>

<template>
  <main id="main-content" class="page topic-detail-page">
    <AppLink class="back-link" href="/community"><ArrowLeft :size="15" />返回社区</AppLink>
    <p v-if="loading" role="status">正在加载…</p>
    <p v-if="error" class="danger-text" role="alert">{{ error }} <button class="button" @click="load">重试</button></p>
    <template v-if="topic && !error">
      <article class="topic-article"><span class="topic-category">{{ topic.category }}</span><h1>{{ topic.title }}</h1><div class="article-author"><UserIdentity :id="topic.ownerId" :name="topic.author" :avatar-url="topic.avatarUrl" :is-admin="topic.isAdmin" /><span>{{ communityTime(topic.time) }} · 社区话题</span></div><InlineModeration kind="topics" :id="topic.id" @deleted="removedTopic" /><div class="article-body"><p v-for="(paragraph, index) in topic.content.split('\n').filter(Boolean)" :key="index">{{ paragraph }}</p></div><div class="article-footnote"><MessageSquare :size="15" /><span>一起聊聊你的想法</span></div></article>
      <section class="topic-reply-section"><h2>参与讨论<span class="subtle-count">{{ total }} 条回复</span></h2><p v-if="!total" class="muted-small">还没有回复，来聊聊你的看法吧。</p><div v-for="item in replies" :key="item.id" class="comment"><div class="reply-content"><div class="reply-author"><UserIdentity :id="item.ownerId" :name="item.author" :avatar-url="item.avatarUrl" :is-admin="item.isAdmin" /><time>{{ communityTime(item.time) }}</time></div><p>{{ item.text }}</p><InlineModeration kind="replies" :id="item.id" @deleted="removedReply" /></div></div>
        <div v-if="total > 50" class="dialog-actions"><button class="button" :disabled="loading || offset === 0" @click="pageReplies(offset - 50)">上一页</button><span>{{ offset + 1 }}–{{ Math.min(offset + 50, total) }} / {{ total }}</span><button class="button" :disabled="loading || offset + 50 >= total" @click="pageReplies(offset + 50)">下一页</button></div>
        <p v-if="replyError" class="danger-text" role="alert">{{ replyError }}</p><button v-if="!user" class="button button-primary" @click="openLogin">登录后参与讨论</button><form v-else @submit.prevent="submitReply"><label for="topic-reply" class="field-label">写下你的回复</label><textarea id="topic-reply" v-model="reply" class="text-input" required maxlength="1000" placeholder="友善的交流，会让创作走得更远。" /><div class="comment-form-footer"><span>回复公开可见</span><button class="button button-primary" :disabled="sending || !reply.trim()"><Send :size="15" />{{ sending ? '正在发送…' : '发送回复' }}</button></div></form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.reply-content{width:100%}.reply-author{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.reply-author time,.article-author>span{font-size:11px;color:#807568}.article-author{flex-wrap:wrap}
</style>
