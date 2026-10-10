<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { ArrowRight, Bookmark, Check, ChevronDown, ChevronRight, Cloud, FolderOpen, Gamepad2, Plus, Settings2, UserRound } from '@lucide/vue'
import { games, initialTopics, isProjects, isStringArray, isTopics, nowLabel, uid, type Project } from './data'
import { useLocalState } from './local-state'
import { navigationKey } from './navigation'
import { accessKey, requiresAccount } from './access'
import { writeCloudBinding } from '../engine/storage'
import AppLink from './AppLink.vue'
import AppModal from './AppModal.vue'
import ArcadePage from './ArcadePage.vue'
import CommunityPage from './CommunityPage.vue'
import EditorPage from './EditorPage.vue'
import GameDetailPage from './GameDetailPage.vue'
import HomePage from './HomePage.vue'
import SiteNavigation from './SiteNavigation.vue'
import NotFoundPage from './NotFoundPage.vue'
import ProfilePage from './ProfilePage.vue'
import ProjectsPage from './ProjectsPage.vue'
import PublishedPreviewPage from './PublishedPreviewPage.vue'
import CloudProjects from './CloudProjects.vue'
import { currentUser, createCloudProject, CloudError, type CloudUser } from '../engine/cloud'
import PlayPage from './PlayPage.vue'
import TopicDetailPage from './TopicDetailPage.vue'

const path = ref(normalizePath(location.pathname))
const editor = ref<InstanceType<typeof EditorPage>>()
let navigationPending = false
const account = ref<CloudUser>()
const accountReady = ref(false)
const creating = ref(false)
const accountScope = computed(() => account.value?.id || 'guest')
const { state: saved, storageError: saveError } = useLocalState<string[]>(() => `tomcat-ui-bookmarks-v2-${accountScope.value}`, [], isStringArray)
const { state: projects, storageError: projectError } = useLocalState<Project[]>(() => `tomcat-ui-projects-v2-${accountScope.value}`, [], isProjects)
const { state: topics, storageError: topicError } = useLocalState('tomcat-ui-topics-v1', initialTopics, isTopics)
const newProject = ref(false)
const projectName = ref('')
const template = ref<'2D' | '空白'>('2D')
const toast = ref('')
const accountOpen = ref(false)
const accountArea = ref<HTMLElement>()
const accountTrigger = ref<HTMLButtonElement>()
function dismissAccount(event: PointerEvent) {
  if (!accountArea.value?.contains(event.target as Node)) accountOpen.value = false
}
function accountKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && accountOpen.value) { accountOpen.value = false; accountTrigger.value?.focus() }
}
const cloudAccountOpen = ref(false)
const accountStatus = ref('')
let accountRequest = 0
async function refreshAccount() {
  const request = ++accountRequest
  accountStatus.value = '正在读取账号…'
  try {
    const user = await currentUser()
    if (request === accountRequest) { account.value = user; accountStatus.value = '云端账号' }
  } catch (error) {
    if (request === accountRequest) {
      account.value = undefined
      accountStatus.value = error instanceof CloudError && error.status === 401 ? '尚未登录' : '云端连接失败，请重试'
    }
  } finally { if (request === accountRequest) accountReady.value = true }
  return Boolean(account.value)
}
function openLogin() { cloudAccountOpen.value = true }
async function requireLogin() {
  const previous = account.value?.id
  if (await refreshAccount()) return !previous || previous === account.value?.id
  openLogin()
  return false
}
provide(accessKey, { user: account, requireLogin, openLogin })
function expireAccount() {
  accountRequest++; account.value = undefined; accountReady.value = true
  accountStatus.value = '登录已失效，请重新登录'
  newProject.value = false
}
function recheckAccount() { void refreshAccount() }
let accountTimer: ReturnType<typeof setInterval> | undefined
function toggleAccount() { accountOpen.value = !accountOpen.value; if (accountOpen.value) void refreshAccount() }
function closeCloudAccount() { cloudAccountOpen.value = false; void refreshAccount() }
let toastTimer: number | undefined

const game = computed(() => games.find(item => path.value === `/games/${item.id}`))
const topic = computed(() => topics.value.find(item => path.value === `/community/${item.id}`))
const previewProject = computed(() => projects.value.find(item => item.status === 'published' && path.value === `/preview/${item.id}`))
const playId = computed(() => path.value.startsWith('/play/') ? path.value.slice('/play/'.length) || undefined : undefined)
const editorProject = computed(() => projects.value.find(item => path.value === `/editor/${item.id}`) || (path.value === '/editor' ? projects.value[0] : undefined))
const blocked = computed(() => requiresAccount(path.value) && (!accountReady.value || !account.value))
const isEditor = computed(() => !blocked.value && Boolean(editorProject.value))
const storageError = computed(() => saveError.value || projectError.value || topicError.value)

function normalizePath(value: string) {
  return value.replace(/\/$/, '') || '/'
}

async function navigate(url: string) {
  accountOpen.value = false
  if (url === path.value || navigationPending) return
  navigationPending = true
  try {
    if (editor.value && !await editor.value.prepareLeave()) return
    history.pushState({}, '', url)
    path.value = normalizePath(url)
    window.scrollTo({ top: 0 })
    accountOpen.value = false
  } finally { navigationPending = false }
}

provide(navigationKey, navigate)

function notify(message: string) {
  toast.value = message
}

async function toggleSave(id: string) {
  if (!await requireLogin()) return
  const wasSaved = saved.value.includes(id)
  saved.value = wasSaved ? saved.value.filter(item => item !== id) : [...saved.value, id]
  notify(wasSaved ? '已取消收藏' : '已加入我的收藏')
}

async function openCreate() {
  if (!await requireLogin()) return
  projectName.value = ''
  template.value = '2D'
  newProject.value = true
}

async function createProject() {
  if (creating.value || !projectName.value.trim()) return
  creating.value = true
  try {
    if (!await requireLogin()) return
    const ownerId = account.value!.id
    const project: Project = { id: uid(), name: projectName.value.trim(), template: template.value, image: '', status: 'draft', updated: nowLabel(), description: '一个新的好玩想法。' }
    const cloud = await createCloudProject(project)
    if (account.value?.id !== ownerId) return
    await writeCloudBinding(project.id, { ownerId, projectId: cloud.id, etag: null, pending: true })
    projects.value = [project, ...projects.value]
    newProject.value = false
    notify('云端项目已创建')
    navigate(`/editor/${project.id}`)
  } catch (error) { notify(error instanceof Error ? error.message : '创建失败，请重试') }
  finally { creating.value = false }
}

function updateProject(next: Project) {
  projects.value = projects.value.map(project => project.id === next.id ? next : project)
}
async function openExperiment(project: Project) {
  projects.value = [project, ...projects.value]
  await nextTick()
  notify('试验副本已保存，正在打开独立引擎会话。')
  await navigate(`/editor/${project.id}`)
}

async function handlePopState() {
  const target = normalizePath(location.pathname)
  if (navigationPending) {
    history.pushState({}, '', path.value)
    return
  }
  navigationPending = true
  try {
    if (editor.value && !await editor.value.prepareLeave()) { history.pushState({}, '', path.value); return }
    history.replaceState({}, '', target)
    path.value = target
    window.scrollTo({ top: 0 })
  } finally { navigationPending = false }
}

watch(toast, value => {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  if (value) toastTimer = window.setTimeout(() => { toast.value = '' }, 3200)
})

watch(path, async () => {
  const title = editorProject.value?.name || previewProject.value?.name || game.value?.title || topic.value?.title ||
    (path.value === '/projects' ? '我的项目' : path.value === '/community' ? '创作者社区' : path.value === '/profile' ? '我的收藏' : path.value === '/play' || playId.value ? '玩家作品' : '发现游戏')
  document.title = `${title} · TomCat`
  await nextTick()
  const main = document.getElementById('main-content')
  main?.setAttribute('tabindex', '-1')
  main?.focus({ preventScroll: true })
}, { immediate: true })

onMounted(() => {
  document.addEventListener('pointerdown', dismissAccount)
  document.addEventListener('keydown', accountKeydown)
  window.addEventListener('popstate', handlePopState)
  window.addEventListener('focus', recheckAccount)
  window.addEventListener('tomcat-auth-changed', recheckAccount)
  window.addEventListener('tomcat-auth-expired', expireAccount)
  void refreshAccount()
  accountTimer = setInterval(recheckAccount, 30000)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismissAccount)
  document.removeEventListener('keydown', accountKeydown)
  accountRequest++
  clearInterval(accountTimer)
  window.removeEventListener('focus', recheckAccount)
  window.removeEventListener('tomcat-auth-changed', recheckAccount)
  window.removeEventListener('tomcat-auth-expired', expireAccount)
  window.removeEventListener('popstate', handlePopState)
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
})
</script>

<template>
  <div class="studio-app" :class="{ 'studio-site': !isEditor }">
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <header v-if="!isEditor" class="site-header">
    <div class="header-inner">
      <AppLink href="/" class="brand" aria-label="TomCat 首页"><span class="brand-mark"><img src="/HubLogo.ico" alt="" /></span><span>tomcat<span class="brand-dot">.</span></span></AppLink>
      <SiteNavigation :path="path" @create="openCreate" />
      <div class="header-actions">
        <button class="button button-primary header-create" @click="openCreate"><Plus :size="16" />新建项目</button>
        <div ref="accountArea" class="account-area">
          <button ref="accountTrigger" class="account-trigger" aria-label="打开我的账户" aria-controls="account-popover" :aria-expanded="accountOpen" @click="toggleAccount"><span class="avatar"><template v-if="account">{{ account.email.slice(0, 1).toUpperCase() }}</template><UserRound v-else :size="17" /></span><ChevronDown :size="13" /></button>
          <div v-if="accountOpen" id="account-popover" class="account-menu" aria-label="我的账户">
            <div class="menu-identity"><span class="menu-avatar"><template v-if="account">{{ account.email.slice(0, 1).toUpperCase() }}</template><UserRound v-else :size="21" /></span><div><span class="menu-caption">{{ account ? '个人账号' : '欢迎来到 TomCat' }}</span><strong :title="account?.email">{{ account ? account.email : '开始你的创作之旅' }}</strong><span class="menu-status">{{ accountStatus }}</span></div></div>
            <div class="menu-group"><button class="menu-row" :aria-label="account ? '管理云端账号' : '登录 / 注册'" @click="cloudAccountOpen = true; accountOpen = false"><Settings2 :size="18" /><span><strong>{{ account ? '管理云端账号' : '登录 / 注册' }}</strong><small>{{ account ? '邮箱、安全与登录设置' : '保存项目，同步你的创作' }}</small></span><ChevronRight :size="15" /></button></div>
            <div class="menu-group"><AppLink class="menu-row" href="/projects"><FolderOpen :size="18" /><span><strong>项目工作台</strong><small>继续未完成的想法</small></span><ChevronRight :size="15" /></AppLink><AppLink class="menu-row" href="/profile"><Bookmark :size="18" /><span><strong>我的收藏</strong><small>随时回到喜欢的世界</small></span><ChevronRight :size="15" /></AppLink></div>
            <div class="menu-footer"><Cloud :size="13" /><span>{{ account ? '你的专属创作空间' : '登录后开启云端工作空间' }}</span><span class="menu-footer-mark">TC</span></div>
          </div>
        </div>
      </div>
    </div>
  </header>

  <main v-if="blocked" id="main-content" class="page access-page">
    <div class="access-art" aria-hidden="true"><span>THE CREATOR’S DESK</span><div class="paper-sheet paper-back"></div><div class="paper-sheet paper-front"><img src="/HubLogo.ico" alt="" /><p>让想法<br />有一个家。</p><small>TOMCAT · CREATIVE WORKSPACE</small></div></div>
    <div class="access-copy"><span class="eyebrow">YOUR SPACE TO CREATE</span>
    <h1>{{ accountReady ? '登录后继续' : '正在验证登录状态…' }}</h1>
    <p>编辑器、项目与收藏需要登录云端账号。游客可以游玩大厅作品、浏览论坛；发帖和评论需要登录。</p>
    <p v-if="accountReady">{{ accountStatus }}</p>
    <button v-if="accountReady" class="button button-primary" @click="openLogin">登录 / 注册</button>
    <AppLink href="/" class="button">返回游戏大厅</AppLink>
    </div>
  </main>
  <HomePage v-else-if="path === '/'" :saved="saved" @toggle-save="toggleSave" @create="openCreate" />
  <ProjectsPage :key="accountScope" v-else-if="path === '/projects'" :projects="projects" @update:projects="projects = $event" @create="openCreate" @notify="notify" />
  <CommunityPage v-else-if="path === '/community'" :topics="topics" @update:topics="topics = $event" @notify="notify" />
  <ProfilePage v-else-if="path === '/profile'" :saved="saved" @toggle-save="toggleSave" />
  <PublishedPreviewPage v-else-if="previewProject" :key="previewProject.id" :project="previewProject" />
  <GameDetailPage v-else-if="game" :key="game.id" :game="game" :saved="saved.includes(game.id)" @toggle-save="toggleSave(game.id)" @notify="notify" />
  <ArcadePage v-else-if="path === '/play'" />
  <PlayPage v-else-if="playId" :key="playId" :game-id="playId" @notify="notify" />
  <TopicDetailPage v-else-if="topic" :key="topic.id" :topic="topic" :topics="topics" @update:topics="topics = $event" @notify="notify" />
  <EditorPage v-else-if="editorProject" ref="editor" :key="`${accountScope}-${editorProject.id}`" :project="editorProject" @update-project="updateProject" @forked="openExperiment" @notify="notify" />
  <NotFoundPage v-else />

  <footer v-if="!isEditor" class="site-footer"><div><AppLink href="/" class="footer-brand">tomcat.</AppLink><span>让好玩的想法发生。</span></div><span>登录创作 · 云端保存</span><span>© 2026 TomCat</span></footer>
  <div v-if="storageError" class="storage-warning" role="alert">浏览器存储不可用，当前修改将在关闭页面后丢失。</div>
  <div v-if="toast" class="toast" role="status"><Check :size="17" />{{ toast }}</div>

  <CloudProjects v-if="cloudAccountOpen" @close="closeCloudAccount" />
  <AppModal v-if="newProject" title="开始一个新项目" @close="newProject = false">
    <p class="dialog-description">先给你的想法起个名字，剩下的慢慢来。</p>
    <form @submit.prevent="createProject"><label class="field-label" for="project-name">项目名称</label><input id="project-name" v-model="projectName" class="text-input" autofocus required maxlength="32" placeholder="例如：森林里的小小冒险" /><span class="field-hint">可以随时修改，最多 32 个字。</span><fieldset class="template-field"><legend>从哪里开始</legend><div class="template-options"><label v-for="item in (['2D', '空白'] as const)" :key="item" class="template-option" :class="{ selected: template === item }"><input v-model="template" type="radio" name="template" :value="item" /><Gamepad2 :size="22" /><strong>{{ item === '2D' ? '2D 场景' : '空白项目' }}</strong><span>{{ item === '2D' ? '从基础场景开始创作' : '留一张白纸给你的想法' }}</span></label></div></fieldset><p class="local-note">新项目必须先创建云端关联，浏览器仅保留恢复用的缓存。</p><div class="dialog-actions"><button type="button" class="button" @click="newProject = false">再想想</button><button class="button button-primary" :disabled="creating || !projectName.trim()">创建项目<ArrowRight :size="16" /></button></div></form>
  </AppModal>
  </div>
</template>
