<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, ArrowLeft, Mail, LockKeyhole, Eye, EyeOff, Check, ShieldCheck, LogOut, FolderOpen, Cloud, RefreshCw, ChevronRight } from '@lucide/vue'
import AppModal from './AppModal.vue'
import { authenticate, forgotPassword, resetPassword, changePassword, requestEmailCode, verifyEmailCode, completeRegistration, currentUser, logout, listCloudProjects, listRevisions, createCloudProject, restoreCloudProject, CloudError, type CloudUser, type CloudProject, type CloudRevision, type RestoredProject } from '../engine/cloud'
import type { CloudBinding } from '../engine/storage'
import type { Project } from './data'
const props = defineProps<{ project?: Project; binding?: CloudBinding; allowRestore?: boolean }>()
const emit = defineEmits<{ close: []; attach: [binding: CloudBinding]; restored: [restored: RestoredProject] }>()
const user = ref<CloudUser>()
const password = ref('')
const email = ref('')
const code = ref('')
const challengeId = ref('')
const token = ref('')
const stage = ref<'credentials' | 'verify'>('credentials')
const resendAt = ref(0)
const notice = ref('')
const resetResendAt = ref(0)
const passwordMode = ref<'none' | 'forgot' | 'reset' | 'change'>('none')
const newPassword = ref('')
const confirmPassword = ref('')
function openPassword(mode: 'none' | 'forgot' | 'change') {
  passwordMode.value = mode; password.value = ''; newPassword.value = ''; confirmPassword.value = ''; code.value = ''
  error.value = ''; notice.value = ''; challengeId.value = ''; stage.value = 'credentials'; token.value = ''
}
function clearAccount() {
  user.value = undefined; projects.value = []; selected.value = undefined; revisions.value = []; token.value = ''
}
function submitPassword() { void perform(async () => {
  if (passwordMode.value === 'forgot') {
    if (Date.now() < resetResendAt.value) throw new Error(`请等待 ${Math.ceil((resetResendAt.value - Date.now()) / 1000)} 秒后重新发送`)
    const result = await forgotPassword(email.value)
    challengeId.value = result.challengeId; resetResendAt.value = Date.now() + result.resendAfter * 1000
    passwordMode.value = 'reset'; notice.value = result.message; return
  }
  if (newPassword.value !== confirmPassword.value) throw new Error('两次输入的新密码不一致')
  try {
    if (passwordMode.value === 'reset') await resetPassword(challengeId.value, code.value, newPassword.value)
    else await changePassword(password.value, newPassword.value)
    clearAccount(); openPassword('none'); mode.value = 'login'; notice.value = '密码已更新，请使用新密码重新登录。'
  } finally { password.value = ''; newPassword.value = ''; confirmPassword.value = '' }
}) }

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
  const result = await requestEmailCode(email.value, password.value)
  challengeId.value = result.challengeId; resendAt.value = Date.now() + result.resendAfter * 1000
  stage.value = 'verify'; code.value = ''; token.value = ''; notice.value = '验证码已发送，请检查邮箱和垃圾邮件。验证码十分钟内有效。'
}
function signIn() { void perform(async () => {
  if (stage.value === 'verify') {
    if (!token.value) token.value = (await verifyEmailCode(challengeId.value, code.value)).token
    user.value = await completeRegistration(token.value)
    token.value = ''; password.value = ''; code.value = ''; notice.value = ''; stage.value = 'credentials'; await refresh()
  } else if (mode.value === 'register') await sendCode()
  else {
    try { user.value = await authenticate('login', email.value, password.value); if (!gone) await refresh() }
    finally { password.value = '' }
  }
}) }
function signOut() { void perform(async () => { await logout(); mode.value = 'login'; stage.value = 'credentials'; notice.value = ''; token.value = ''; password.value = ''; user.value = undefined; projects.value = []; selected.value = undefined }) }
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
onBeforeUnmount(() => { gone = true; window.clearInterval(ticker) })
const showPassword = ref(false)
const now = ref(Date.now())
const ticker = window.setInterval(() => { now.value = Date.now() }, 1000)
const resendSeconds = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)))
const resetSeconds = computed(() => Math.max(0, Math.ceil((resetResendAt.value - now.value) / 1000)))
const title = computed(() => passwordMode.value === 'change' ? '更新你的密码' : passwordMode.value !== 'none' ? '找回你的账号' : user.value ? '我的账号' : stage.value === 'verify' ? '检查你的收件箱' : mode.value === 'login' ? '欢迎回到创作现场。' : '从一个想法开始。')
</script>
<template>
  <AppModal :title="title" wide class="account-dialog" @close="!busy && emit('close')">
    <div class="account-layout" :class="{ 'account-layout-signed': user && passwordMode === 'none' }">
      <aside class="account-story" aria-hidden="true">
        <div class="account-wordmark"><img src="/HubLogo.ico" alt="" />tomcat<span>.</span></div>
        <div class="account-story-copy"><span class="account-eyebrow">A LITTLE SPACE FOR BIG IDEAS</span><h2>好玩的世界，<br />从你开始。</h2><p>收好灵感，搭起场景。<br />让下一个小世界慢慢长出来。</p></div>
        <div class="account-illustration"><div class="studio-grid"></div><div class="studio-window"><i></i><i></i><i></i><i></i></div><div class="studio-step step-one"></div><div class="studio-step step-two"></div><div class="studio-block"><span>✦</span></div><div class="studio-caption"><span>YOUR NEXT WORLD</span><span>01 — ∞</span></div></div>
        <div class="account-story-footer"><Cloud :size="16" /><span>你的创作，随时继续。</span></div>
      </aside>
      <section class="account-content" :aria-busy="busy">
        <div class="account-heading"><span class="account-eyebrow">{{ user ? 'YOUR CREATIVE ACCOUNT' : 'WELCOME TO TOMCAT' }}</span><h2>{{ title }}</h2><p>{{ passwordMode === 'change' ? '为你的创作空间换一把新钥匙。' : passwordMode !== 'none' ? '验证邮箱后，就可以设置新密码。' : user ? '管理登录信息，继续你的创作。' : stage === 'verify' ? '最后一步，验证这个邮箱属于你。' : mode === 'login' ? '登录邮箱，接着完成上次的灵感。' : '用邮箱创建账号，开启你的创作空间。' }}</p></div>
        <div v-if="error" class="account-message account-message-error" role="alert">{{ error }}</div>
        <div v-if="notice" class="account-message" role="status"><Check :size="16" />{{ notice }}</div>

        <form v-if="passwordMode !== 'none'" class="account-form" @submit.prevent="submitPassword">
          <template v-if="passwordMode === 'forgot'">
            <label for="recovery-email">邮箱地址</label><div class="account-input"><Mail :size="18" /><input id="recovery-email" v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" :disabled="busy" /></div>
          </template>
          <template v-else>
            <template v-if="passwordMode === 'reset'">
              <div class="verification-address"><Mail :size="18" /><span>{{ email }}</span></div>
              <label for="recovery-code">六位验证码</label><input id="recovery-code" v-model="code" class="account-code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" />
              <button type="button" class="account-text-link resend-link" :disabled="busy || resetSeconds > 0" @click="passwordMode = 'forgot'; code = ''; newPassword = ''; confirmPassword = ''">{{ resetSeconds ? `${resetSeconds} 秒后可重发` : '重新发送验证码' }}</button>
            </template>
            <template v-else><label for="current-password">当前密码</label><div class="account-input"><LockKeyhole :size="18" /><input id="current-password" v-model="password" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy" /></div></template>
            <label for="new-password">新密码</label><div class="account-input"><LockKeyhole :size="18" /><input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" :disabled="busy" /></div>
            <label for="confirm-password">确认新密码</label><div class="account-input"><LockKeyhole :size="18" /><input id="confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" :disabled="busy" /></div>
            <p class="account-hint">至少 12 个字符。更新后，所有设备需要重新登录。</p>
          </template>
          <button class="account-submit" :disabled="busy || passwordMode === 'forgot' && resetSeconds > 0">{{ busy ? '处理中…' : passwordMode === 'forgot' ? '发送重置验证码' : passwordMode === 'reset' ? '重置密码' : '确认修改密码' }}<ArrowRight :size="18" /></button>
          <button type="button" class="account-back" :disabled="busy" @click="openPassword('none')"><ArrowLeft :size="15" />{{ user ? '返回账号' : '返回登录' }}</button>
        </form>

        <form v-else-if="!user" class="account-form" @submit.prevent="signIn">
          <template v-if="stage === 'credentials'">
            <div class="account-tabs" aria-label="选择登录方式"><button type="button" aria-label="切换到登录" :aria-pressed="mode === 'login'" :class="{ selected: mode === 'login' }" :disabled="busy" @click="mode !== 'login' && switchMode()">登录</button><button type="button" aria-label="切换到注册" :aria-pressed="mode === 'register'" :class="{ selected: mode === 'register' }" :disabled="busy" @click="mode !== 'register' && switchMode()">创建账号</button></div>
            <label for="cloud-email">邮箱地址</label><div class="account-input"><Mail :size="18" /><input id="cloud-email" v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" :disabled="busy" /></div>
            <div class="account-label-row"><label for="cloud-password">密码</label><button v-if="mode === 'login'" type="button" class="account-text-link" :disabled="busy" @click="openPassword('forgot')">忘记密码</button></div>
            <div class="account-input"><LockKeyhole :size="18" /><input id="cloud-password" v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :placeholder="mode === 'login' ? '输入你的密码' : '至少 12 个字符'" required :minlength="mode === 'register' ? 12 : undefined" maxlength="128" :disabled="busy" /><button type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="17" /><Eye v-else :size="17" /></button></div>
            <p v-if="mode === 'register'" class="account-hint">我们会发送一封验证邮件，验证后即可开始创作。</p>
          </template>
          <template v-else>
            <div class="verification-address"><Mail :size="18" /><span>{{ email }}</span></div>
            <label for="cloud-code">六位验证码</label><input id="cloud-code" v-model="code" class="account-code" inputmode="numeric" autocomplete="one-time-code" required placeholder="000000" pattern="[0-9]{6}" maxlength="6" :disabled="busy" />
            <div class="account-resend"><span>没有收到邮件？</span><button type="button" class="account-text-link" :disabled="busy || resendSeconds > 0" @click="perform(sendCode)">{{ resendSeconds ? `${resendSeconds} 秒后可重发` : '重新发送验证码' }}</button></div>
          </template>
          <button class="account-submit" :disabled="busy">{{ busy ? '处理中…' : stage === 'verify' ? '验证邮箱并创建账号' : mode === 'login' ? '登录' : '发送验证码' }}<ArrowRight :size="18" /></button>
          <button v-if="stage === 'verify'" type="button" class="account-back" :disabled="busy" @click="stage = 'credentials'; token = ''; notice = ''; error = ''"><ArrowLeft :size="15" />修改邮箱</button>
          <p class="account-form-footer"><ShieldCheck :size="15" />{{ mode === 'login' ? '登录后，即可同步你的创作。' : '邮箱仅用于登录、验证和账号找回。' }}</p>
        </form>

        <div v-else class="account-dashboard">
          <div class="account-identity"><span class="account-monogram">{{ user.email.slice(0, 1).toUpperCase() }}</span><div><strong>{{ user.email }}</strong><span><span class="verified-dot"></span>邮箱已验证</span></div></div>
          <div class="account-section-label">账号与安全</div>
          <button class="account-setting" aria-label="修改密码" :disabled="busy" @click="openPassword('change')"><span class="setting-icon"><LockKeyhole :size="19" /></span><span><strong>登录密码</strong><small>更新密码，保护你的创作空间</small></span><ChevronRight :size="18" /></button>
          <template v-if="project"><div class="account-project-card"><FolderOpen :size="22" /><h3>{{ project.name }}</h3><p>{{ binding ? '项目已关联云端，编辑器中可随时保存。' : '关联云端，保存场景、配置和资源。' }}</p><button class="account-submit" :disabled="busy" @click="create">{{ binding ? '另建云端项目' : '创建云端项目并关联' }}<ArrowRight :size="17" /></button></div></template>
          <template v-if="allowRestore">
            <div class="account-section-label account-project-heading"><span>云端项目 <span class="account-count">{{ projects.length }}</span></span><button class="account-text-link" :disabled="busy" @click="perform(refresh)"><RefreshCw :size="13" />刷新</button></div>
            <ul class="account-projects"><li v-for="item in projects" :key="item.id"><button :class="{ selected: selected?.id === item.id }" :disabled="busy" @click="choose(item)"><FolderOpen :size="20" /><span><strong>{{ item.name }}</strong><small>{{ item.currentRevisionId ? '已有云端修订' : '尚未保存' }}</small></span><ChevronRight :size="16" /></button></li></ul>
            <div v-if="!projects.length && !busy" class="account-empty"><FolderOpen :size="28" /><strong>你的第一个世界，等你开始</strong><p>创建项目后，就能在这里找到云端记录。</p></div>
            <div v-if="selected" class="account-restore"><label class="field-label" for="cloud-revision">{{ selected.name }} · 恢复版本</label><select id="cloud-revision" v-model="revision" class="text-input"><option value="">最新修订</option><option v-for="item in revisions" :key="item.revisionId" :value="item.revisionId">{{ new Date(item.createdAt).toLocaleString() }}{{ item.aiCheckpoint ? ` · AI ${item.aiCheckpoint.phase === 'start' ? '开始' : '结束'}` : '' }}</option></select><p class="account-hint">恢复为独立副本，不覆盖当前编辑内容。</p><button class="account-submit" :disabled="busy || !selected.currentRevisionId" @click="restore">{{ busy ? '校验并下载中…' : '恢复为本地副本' }}<ArrowRight :size="17" /></button></div>
          </template>
          <button class="account-signout" :disabled="busy" @click="signOut"><LogOut :size="16" />退出账号</button>
        </div>
      </section>
    </div>
  </AppModal>
</template>
<style src="./account.css"></style>
