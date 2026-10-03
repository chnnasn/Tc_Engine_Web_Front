<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import { authenticate, requestEmailCode, verifyEmailCode, completeRegistration, currentUser, logout, listCloudProjects, listRevisions, createCloudProject, restoreCloudProject, CloudError, type CloudUser, type CloudProject, type CloudRevision, type RestoredProject } from '../engine/cloud'
import type { CloudBinding } from '../engine/storage'
import type { Project } from './data'
const props = defineProps<{ project?: Project; binding?: CloudBinding; allowRestore?: boolean }>()
const emit = defineEmits<{ close: []; attach: [binding: CloudBinding]; restored: [restored: RestoredProject] }>()
const user = ref<CloudUser>()
const username = ref('')
const password = ref('')
const email = ref('')
const code = ref('')
const challengeId = ref('')
const token = ref('')
const stage = ref<'credentials' | 'verify' | 'username'>('credentials')
const bindingEmail = ref(false)
const resendAt = ref(0)
const notice = ref('')
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
function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  stage.value = 'credentials'; password.value = ''; code.value = ''; token.value = ''; error.value = ''; notice.value = ''
}
async function sendCode() {
  if (Date.now() < resendAt.value) throw new Error(`请等待 ${Math.ceil((resendAt.value - Date.now()) / 1000)} 秒后重新发送`)
  const result = await requestEmailCode(email.value, password.value, bindingEmail.value)
  challengeId.value = result.challengeId; resendAt.value = Date.now() + result.resendAfter * 1000
  stage.value = 'verify'; code.value = ''; notice.value = '验证码已发送，请检查邮箱和垃圾邮件。验证码十分钟内有效。'
}
function signIn() { void perform(async () => {
  if (stage.value === 'verify') {
    const result = await verifyEmailCode(challengeId.value, code.value)
    token.value = result.token; password.value = ''; code.value = ''; notice.value = ''
    if (result.binding && user.value) {
      user.value = await completeRegistration(token.value, user.value.username)
      bindingEmail.value = false; stage.value = 'credentials'; notice.value = '邮箱已绑定，以后请使用邮箱登录。'
    } else stage.value = 'username'
  } else if (stage.value === 'username') {
    user.value = await completeRegistration(token.value, username.value)
    token.value = ''; stage.value = 'credentials'; await refresh()
  } else if (mode.value === 'register' || bindingEmail.value) await sendCode()
  else {
    try { user.value = await authenticate('login', email.value, password.value); if (!gone) await refresh() }
    finally { password.value = '' }
  }
}) }
function signOut() { void perform(async () => { await logout(); bindingEmail.value = false; stage.value = 'credentials'; notice.value = ''; token.value = ''; password.value = ''; user.value = undefined; projects.value = []; selected.value = undefined }) }
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
    <p v-if="notice" class="local-note" role="status">{{ notice }}</p>
    <form v-if="!user || bindingEmail" @submit.prevent="signIn">
      <div class="auth-intro"><img src="/HubLogo.ico" alt="" /><h3>{{ bindingEmail ? '绑定邮箱' : mode === 'login' ? '欢迎回来' : '创建账号' }}</h3></div>
      <template v-if="stage === 'credentials'">
        <p class="local-note">{{ bindingEmail ? '验证邮箱后，原账号与项目将保留。' : mode === 'login' ? '使用邮箱登录；尚未绑定邮箱的旧账号可填写原用户名。' : '验证邮箱后设置用户名，用于展示你的作品。' }}</p>
        <label class="field-label" for="cloud-username">{{ mode === 'login' && !bindingEmail ? '邮箱 / 旧账号用户名' : '邮箱' }}</label>
        <input id="cloud-username" v-model="email" class="text-input" :type="mode === 'login' && !bindingEmail ? 'text' : 'email'" autocomplete="username" required maxlength="254" :disabled="busy" />
        <template v-if="!bindingEmail">
          <label class="field-label" for="cloud-password">密码</label><input id="cloud-password" v-model="password" class="text-input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required minlength="12" maxlength="128" :disabled="busy" />
        </template>
      </template>
      <template v-else-if="stage === 'verify'">
        <p>验证邮箱：{{ email }}</p>
        <label class="field-label" for="cloud-code">六位验证码</label><input id="cloud-code" v-model="code" class="text-input" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" :disabled="busy" />
        <button type="button" class="button" :disabled="busy" @click="perform(sendCode)">重新发送验证码</button>
      </template>
      <template v-else>
        <label class="field-label" for="cloud-display-name">用户名</label><input id="cloud-display-name" v-model="username" class="text-input" autocomplete="nickname" required pattern="[a-zA-Z0-9_]{3,32}" minlength="3" maxlength="32" :disabled="busy" />
        <p class="local-note">3–32 个字母、数字或下划线；登录时使用邮箱。</p>
      </template>
      <div class="dialog-actions">
        <button v-if="!bindingEmail" type="button" class="button" :disabled="busy" @click="switchMode">{{ mode === 'login' ? '切换到注册' : '返回登录' }}</button>
        <button v-else type="button" class="button" :disabled="busy" @click="bindingEmail = false; stage = 'credentials'; notice = ''; password = ''; token = ''">取消绑定</button>
        <button class="button button-primary" :disabled="busy">{{ busy ? '处理中…' : stage === 'verify' ? '验证邮箱' : stage === 'username' ? '完成注册' : mode === 'login' && !bindingEmail ? '登录' : '发送验证码' }}</button>
      </div>
    </form>
    <template v-else>
      <p>当前账号：<strong>{{ user.username }}</strong> <button class="button" :disabled="busy" @click="signOut">退出账号</button></p>
      <p v-if="user.email">邮箱：{{ user.email }}</p>
      <button v-else class="button" :disabled="busy" @click="bindingEmail = true; email = ''; stage = 'credentials'; notice = ''; resendAt = 0">绑定邮箱</button>
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
