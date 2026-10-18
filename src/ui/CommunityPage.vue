<script setup lang="ts">
import { useAccess } from './access'
import { onMounted, ref, watch } from 'vue'
import { ChevronRight, MessageSquare, Pin, Plus, Send } from '@lucide/vue'
import { topicCategories, type Topic } from './data'
import { listTopics, createTopic, communityTime } from './community-api'
import { useNavigation } from './navigation'
import AppLink from './AppLink.vue'
import AppModal from './AppModal.vue'
import EmptyState from './EmptyState.vue'
import SearchField from './SearchField.vue'

const { user, requireLogin } = useAccess()
const emit = defineEmits<{ notify: [message: string] }>()
const topics = ref<Topic[]>([])
const total = ref(0)
const offset = ref(0)
const loading = ref(false)
const publishing = ref(false)
const error = ref('')
const publishError = ref('')
let request = 0
const navigate = useNavigation()
const category = ref('全部话题')
const query = ref('')
const compose = ref(false)
const title = ref('')
const content = ref('')
const postCategory = ref('综合讨论')
async function load() {
  const current = ++request
  loading.value = true; error.value = ''
  try {
    const page = await listTopics(offset.value, category.value === '全部话题' ? '' : category.value, query.value.trim())
    if (current === request) { topics.value = page.items; total.value = page.total }
  } catch (cause) { if (current === request) error.value = cause instanceof Error ? cause.message : '社区加载失败' }
  finally { if (current === request) loading.value = false }
}
watch([category, query], () => { offset.value = 0; void load() })
watch(offset, () => void load())
onMounted(load)

async function publish() {
  if (publishing.value || !await requireLogin()) return
  if (!title.value.trim() || !content.value.trim()) return
  publishing.value = true; publishError.value = ''
  try {
    const topic = await createTopic(title.value.trim(), content.value.trim(), postCategory.value)
    compose.value = false
    emit('notify', '话题已发布')
    navigate(`/community/${topic.id}`)
  } catch (cause) { publishError.value = cause instanceof Error ? cause.message : '发布失败，请重试' }
  finally { publishing.value = false }
}
</script>

<template>
  <main id="main-content" class="page community-page">
    <div class="page-topline"><div class="page-intro"><span class="eyebrow">MADE BETTER, TOGETHER</span><h1>创作者社区<span class="green-dot">.</span></h1><p>聊聊游戏，分享进展，也为彼此的想法加一点油。</p></div><button class="button button-primary" @click="async () => { if (await requireLogin()) compose = true }"><Plus :size="16" />发起话题</button></div>
    <p v-if="error" class="danger-text" role="alert">{{ error }} <button class="button" @click="load">重试</button></p>
    <div class="community-layout">
      <div class="community-main">
        <div class="section-index"><span>THE CONVERSATION</span><span>{{ total }} 个话题 · 创作手记</span></div>
        <div class="community-filter"><div class="filter-tabs"><button v-for="item in topicCategories" :key="item" :class="{ active: category === item }" :aria-pressed="category === item" @click="category = item">{{ item }}</button></div><SearchField v-model="query" placeholder="搜索话题或创作者" /></div>
        <div class="topics-list">
          <AppLink v-for="topic in topics" :key="topic.id" class="topic-row" :href="`/community/${topic.id}`"><span class="topic-avatar" :style="{ background: topic.color }">{{ topic.avatar }}</span><div class="topic-main"><h3><Pin v-if="topic.pinned" :size="13" class="pin-icon" />{{ topic.title }}</h3><div class="topic-meta"><span class="topic-category">{{ topic.category }}</span><span>{{ topic.author }}</span><span>{{ communityTime(topic.time) }}</span></div></div><span class="topic-replies"><MessageSquare :size="16" /><span>{{ topic.replies }}</span></span><ChevronRight :size="16" class="topic-chevron" /></AppLink>
          <p v-if="loading" role="status">正在加载话题…</p>
          <EmptyState v-if="!loading && !error && !topics.length" title="还没有找到这个话题" text="换个关键词，或发起一个新的讨论。" />
        </div>
        <div v-if="total > 50" class="dialog-actions"><button class="button" :disabled="loading || offset === 0" @click="offset -= 50">上一页</button><span>{{ offset + 1 }}–{{ Math.min(offset + 50, total) }} / {{ total }}</span><button class="button" :disabled="loading || offset + 50 >= total" @click="offset += 50">下一页</button></div>
        <p class="list-end">每个想法，都值得被听见。</p>
      </div>
      <aside class="community-sidebar"><div class="community-welcome"><span class="eyebrow">HELLO, CREATOR</span><h2>很高兴在这里<br />遇见你。</h2><p>不论你是第一次尝试创作，还是已经做了很多个游戏，这里总有一个位置留给你。</p><button class="button" @click="async () => { if (await requireLogin()) compose = true }">从打个招呼开始</button></div><div class="community-guide"><h3>让交流简单一点</h3><p><span>01</span>分享真实的创作过程</p><p><span>02</span>给出具体、友善的反馈</p><p><span>03</span>尊重每一个不同的想法</p></div><div class="sidebar-note"><MessageSquare :size="17" /><p>话题和回复公开可见。<br />请勿发布隐私和不当内容。</p></div></aside>
    </div>

    <AppModal v-if="compose && user" title="分享你的新想法" wide @close="compose = false">
      <p class="dialog-description">开发日常、创作问题，或者一个值得分享的小发现。</p>
      <form @submit.prevent="publish"><label class="field-label" for="topic-title">话题标题</label><input id="topic-title" v-model="title" class="text-input" required autofocus maxlength="80" placeholder="用一句话说说你想聊什么" /><label class="field-label" for="topic-category">选择分类</label><select id="topic-category" v-model="postCategory" class="text-input"><option v-for="item in topicCategories.slice(1)" :key="item">{{ item }}</option></select><label class="field-label" for="topic-content">正文</label><textarea id="topic-content" v-model="content" class="text-input compose-textarea" required maxlength="5000" placeholder="从这里开始，慢慢说。" /><p class="local-note">发布后所有人都能看到此话题。</p><p v-if="publishError" class="danger-text" role="alert">{{ publishError }}</p><div class="dialog-actions"><button class="button" type="button" :disabled="publishing" @click="compose = false">取消</button><button class="button button-primary" :disabled="publishing || !title.trim() || !content.trim()"><Send :size="15" />{{ publishing ? '正在发布…' : '发布话题' }}</button></div></form>
    </AppModal>
  </main>
</template>
