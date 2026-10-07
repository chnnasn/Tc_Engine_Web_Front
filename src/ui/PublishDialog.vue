<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, CloudUpload, ExternalLink, LoaderCircle, TriangleAlert, Undo2 } from '@lucide/vue'
import AppModal from './AppModal.vue'
import AppLink from './AppLink.vue'
import { CloudError, fetchPublishState, publishProject, unpublishProject, type PublishState } from '../engine/cloud'

const props = defineProps<{ projectId?: string; projectName: string; projectDescription: string; dirty: boolean }>()
const emit = defineEmits<{ close: []; notify: [message: string] }>()
const title = ref(props.projectName)
const description = ref(props.projectDescription)
const state = ref<PublishState>()
const submitting = ref(false)
const withdrawing = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let request = 0

const pending = computed(() => state.value?.status === 'pending')
const published = computed(() => state.value?.status === 'published')
const failed = computed(() => state.value?.status === 'failed')

function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = undefined } }
async function poll(pollRequest: number) {
  if (!props.projectId || pollRequest !== request) return
  try {
    const next = await fetchPublishState(props.projectId)
    if (pollRequest !== request) return
    if (next) {
      state.value = next
      if (next.status === 'published') { emit('notify', '作品已发布，玩家可以在“玩家作品”中找到它'); return }
      if (next.status === 'failed') return
    }
  } catch { /* 轮询失败保持当前状态，下个周期重试。 */ }
  pollTimer = setTimeout(() => void poll(pollRequest), 2000)
}
async function submit() {
  if (!props.projectId || props.dirty || submitting.value || !title.value.trim()) return
  submitting.value = true
  try {
    state.value = await publishProject(props.projectId, title.value.trim(), description.value.trim())
    if (state.value.status === 'pending') { const current = ++request; void poll(current) }
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '发布请求失败，请重试')
    if (error instanceof CloudError && error.status === 401) emit('close')
  } finally { submitting.value = false }
}
async function withdraw() {
  if (!props.projectId || withdrawing.value) return
  if (!window.confirm('取消发布后，玩家将无法再打开这个作品。确定取消发布吗？')) return
  withdrawing.value = true
  try {
    await unpublishProject(props.projectId)
    state.value = undefined
    emit('notify', '已取消发布')
  } catch (error) { emit('notify', error instanceof Error ? error.message : '取消发布失败，请重试') }
  finally { withdrawing.value = false }
}
onMounted(async () => {
  if (!props.projectId) return
  try {
    const existing = await fetchPublishState(props.projectId)
    if (existing) { state.value = existing; if (existing.status === 'pending') { const current = ++request; void poll(current) } }
  } catch (error) { emit('notify', error instanceof Error ? error.message : '读取发布状态失败') }
})
onBeforeUnmount(() => { request++; stopPolling() })
</script>
<template>
  <AppModal title="发布作品" @close="emit('close')">
    <template v-if="!projectId">
      <p class="local-note">请先打开编辑器，将项目保存到云端后再发布。</p>
      <div class="dialog-actions"><button class="button" @click="emit('close')">知道了</button></div>
    </template>
    <template v-else>
      <p v-if="dirty" class="local-note">项目有尚未同步到云端的内容。请先打开编辑器并“保存到云端”，再回来发布。</p>
      <div v-if="pending" class="publish-state" role="status">
        <LoaderCircle :size="20" class="spin" />
        <div><strong>正在打包作品…</strong><p>服务器正在把你的项目打包成游戏包，通常需要几十秒到几分钟。可以关闭对话框，稍后再回来看结果。</p></div>
      </div>
      <div v-else-if="failed" class="publish-state failed" role="alert">
        <TriangleAlert :size="20" />
        <div><strong>发布失败</strong><p>{{ state?.error || '打包工具未能产出游戏包。' }}</p></div>
      </div>
      <div v-else-if="published" class="publish-state ok">
        <Check :size="20" />
        <div><strong>已发布</strong><p>玩家可以在“玩家作品”页面打开这个作品。</p></div>
      </div>
      <form @submit.prevent="submit">
        <label class="field-label" for="publish-title">作品名称</label>
        <input id="publish-title" v-model="title" class="text-input" required maxlength="64" placeholder="给作品一个响亮的名字" />
        <label class="field-label" for="publish-description">作品介绍</label>
        <textarea id="publish-description" v-model="description" class="text-input compose-textarea" maxlength="1000" placeholder="向玩家介绍你的世界。"></textarea>
        <p class="local-note">发布的是最近一次云端保存的完整项目；已发布后可随时更新或取消发布。</p>
        <div class="dialog-actions">
          <button v-if="published || failed" type="button" class="button" :disabled="withdrawing" @click="withdraw"><Undo2 :size="15" />{{ withdrawing ? '取消中…' : '取消发布' }}</button>
          <AppLink v-if="published" :href="`/play/${projectId}`" class="button button-primary">打开游玩页面<ExternalLink :size="15" /></AppLink>
          <button type="submit" class="button button-primary" :disabled="dirty || submitting || pending || !title.trim()">
            <CloudUpload :size="15" />{{ pending ? '打包中…' : failed ? '重新发布' : published ? '更新发布' : '发布' }}
          </button>
        </div>
      </form>
    </template>
  </AppModal>
</template>
<style scoped>
.publish-state{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:#eef3ea;margin-bottom:12px}
.publish-state.failed{background:#f6e9e4}
.publish-state strong{display:block;font-size:14px}
.publish-state p{margin:4px 0 0;font-size:13px;color:#5c6b60}
.spin{animation:spin 1.2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
