<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import { authenticate, currentUser, logout, listCloudProjects, listRevisions, createCloudProject, restoreCloudProject, CloudError, type CloudUser, type CloudProject, type CloudRevision, type RestoredProject } from '../engine/cloud'
import type { CloudBinding } from '../engine/storage'
import type { Project } from './data'
const props = defineProps<{ project?: Project; binding?: CloudBinding; allowRestore?: boolean }>()
const emit = defineEmits<{ close: []; attach: [binding: CloudBinding]; restored: [restored: RestoredProject] }>()
const user = ref<CloudUser>()
const username = ref('')
const password = ref('')
const mode = ref<'login' | 'register'>('login')
const busy = ref(false)
const error = ref('')
const projects = ref<CloudProject[]>([])
const selected = ref<CloudProject>()
const revisions = ref<CloudRevision[]>([])
const revision = ref('')
let gone = false
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action() } catch (cause) { if (!gone) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function refresh() { projects.value = await listCloudProjects() }
function signIn() { void perform(async () => {
  try { user.value = await authenticate(mode.value, username.value, password.value); if (!gone) await refresh() }
  finally { password.value = '' }
}) }
function signOut() { void perform(async () => { await logout(); user.value = undefined; projects.value = []; selected.value = undefined }) }
function create() { void perform(async () => {
  if (!props.project || !user.value) return
  const project = await createCloudProject(props.project)
  if (!gone) emit('attach', { ownerId: user.value.id, projectId: project.id, etag: null, pending: true })
}) }
function choose(project: CloudProject) { void perform(async () => { const list = await listRevisions(project.id); selected.value = project; revisions.value = list; revision.value = '' }) }
function restore() { void perform(async () => {
  if (!selected.value) return
  const restored = await restoreCloudProject(selected.value.id, revision.value || undefined)
  if (!gone) emit('restored', restored)
}) }
onMounted(() => { void perform(async () => {
  try { user.value = await currentUser(); await refresh() }
  catch (cause) { if (!(cause instanceof CloudError && cause.status === 401)) throw cause }
}) })
onBeforeUnmount(() => { gone = true })
</script>
<template>
  <AppModal title="云端项目" @close="!busy && emit('close')">
    <p v-if="error" class="cloud-error" role="alert">{{ error }}</p>
    <form v-if="!user" @submit.prevent="signIn">
      <p class="local-note">编辑器和创作操作必须登录。项目与云端账号绑定，游客可以游玩大厅作品和浏览论坛。</p>
      <label class="field-label" for="cloud-username">用户名</label><input id="cloud-username" v-model="username" class="text-input" autocomplete="username" required minlength="3" maxlength="32" />
      <label class="field-label" for="cloud-password">密码</label><input id="cloud-password" v-model="password" class="text-input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required minlength="12" maxlength="128" />
      <div class="dialog-actions"><button type="button" class="button" :disabled="busy" @click="mode = mode === 'login' ? 'register' : 'login'">{{ mode === 'login' ? '切换到注册' : '切换到登录' }}</button><button class="button button-primary" :disabled="busy">{{ busy ? '连接中…' : mode === 'login' ? '登录' : '注册并登录' }}</button></div>
    </form>
    <template v-else>
      <p>当前账号：<strong>{{ user.username }}</strong> <button class="button" :disabled="busy" @click="signOut">退出账号</button></p>
      <template v-if="project">
        <p v-if="binding" class="local-note">此项目已关联云端。点击编辑器中的“保存到云端”将同时保存场景、配置和资源。</p>
        <p v-else class="local-note">关联后，编辑器的保存和 Ctrl / ⌘ + S 会保存到云端。网络失败时保留本地草稿。</p>
        <div class="dialog-actions"><button class="button button-primary" :disabled="busy" @click="create">{{ binding ? '另建云端项目' : '创建云端项目并关联' }}</button></div>
        <p class="local-note">已有云端项目可在项目列表的“云端项目”中恢复；不会覆盖当前编辑内容。</p>
      </template>
      <template v-if="allowRestore">
        <p class="local-note">恢复会创建本地副本。最新修订保持云端关联，历史修订会在进入编辑器时创建新的云端项目。</p>
        <button class="button" :disabled="busy" @click="perform(refresh)">刷新云端列表</button>
        <ul class="cloud-list"><li v-for="item in projects" :key="item.id"><button class="button" :disabled="busy" @click="choose(item)">{{ item.name }}{{ item.currentRevisionId ? '' : '（尚未保存）' }}</button></li></ul>
        <p v-if="!projects.length && !busy">暂无云端项目。</p>
        <div v-if="selected">
          <label class="field-label" for="cloud-revision">{{ selected.name }} · 恢复版本</label>
          <select id="cloud-revision" v-model="revision" class="text-input"><option value="">最新修订</option><option v-for="item in revisions" :key="item.revisionId" :value="item.revisionId">{{ new Date(item.createdAt).toLocaleString() }} · {{ item.revisionId.slice(0, 8) }}{{ item.aiCheckpoint ? ` · AI ${item.aiCheckpoint.phase === 'start' ? '开始' : '结束'} · ${item.aiCheckpoint.runId.slice(0, 8)}` : '' }}</option></select>
          <div class="dialog-actions"><button class="button button-primary" :disabled="busy || !selected.currentRevisionId" @click="restore">{{ busy ? '校验并下载中…' : '恢复为本地副本' }}</button></div>
        </div>
      </template>
    </template>
  </AppModal>
</template>
<style scoped>.cloud-error{color:#a32e2e;white-space:pre-wrap}.cloud-list{list-style:none;padding:0;max-height:220px;overflow:auto}.cloud-list li{margin:8px 0}.cloud-list .button{width:100%;justify-content:flex-start}</style>
