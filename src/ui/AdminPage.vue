<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ShieldCheck, RefreshCw, Search, Trash2, Pin, Users, MessageSquare, Gamepad2, ClipboardList } from '@lucide/vue'
import { useAccess } from './access'
import { siteApi, communityTime, type Page } from './community-api'
import AppLink from './AppLink.vue'
import AppModal from './AppModal.vue'
import UserIdentity from './UserIdentity.vue'

type Tab = 'users' | 'topics' | 'publications' | 'audit'
interface RecordRow {
  id: string; email?: string; title?: string; content?: string; category?: string; author?: string; ownerId?: string; authorName?: string; authorIsAdmin?: number;
  createdAt?: string; projects?: number; replies?: number; isAdmin?: number; suspended?: number;
  pinned?: number; topicId?: string; topicTitle?: string; blocked?: number; status?: string;
  reason?: string; actor?: string; action?: string; targetId?: string; description?: string; displayName?: string; avatarVersion?: string; onlineSeconds?: number; lastSeenAt?: number; online?: number
}
interface Pending { label: string; path: string; method: string; values?: Record<string, boolean>; detail: string }
const { user } = useAccess()
const emit = defineEmits<{ notify: [message: string] }>()
const tabs = [
  { id: 'users' as Tab, label: '账号管理', icon: Users },
  { id: 'topics' as Tab, label: '社区话题', icon: MessageSquare },
  { id: 'publications' as Tab, label: '作品管理', icon: Gamepad2 },
  { id: 'audit' as Tab, label: '操作记录', icon: ClipboardList },
]
const statLabels: Record<string, string> = { users: '注册人数', newUsersToday: '今日注册', dailyActiveUsers: '今日活跃', onlineUsers: '当前在线', todayOnlineSeconds: '今日在线时长', totalOnlineSeconds: '累计在线时长' }
const actionLabels: Record<string, string> = { suspend_user: '封禁账号', restore_user: '解除封禁', pin_topic: '置顶话题', unpin_topic: '取消置顶', delete_topics: '删除话题', delete_replies: '删除回复', block_game: '下架作品', restore_game: '解除下架' }
const tab = ref<Tab>('users')
const query = ref('')
const accountState = ref('all')
const activity = ref<{ day: string; registrations: number; activeUsers: number; onlineSeconds: number }[]>([])
const filter = ref('')
const offset = ref(0)
const total = ref(0)
const rows = ref<RecordRow[]>([])
const stats = ref<Record<string, number>>({})
const loading = ref(false)
const error = ref('')
const actionError = ref('')
const pending = ref<Pending>()
const reason = ref('')
const saving = ref(false)
const heading = computed(() => tabs.find(item => item.id === tab.value)!.label)
let revision = 0
const activityTimer = setInterval(async () => {
  if (!user.value?.isAdmin || document.visibilityState !== 'visible') return
  try {
    const [overview, trend] = await Promise.all([siteApi<Record<string, number>>('/admin/overview'), siteApi<typeof activity.value>('/admin/activity')])
    if (user.value?.isAdmin) { stats.value = overview; activity.value = trend }
  } catch { /* The refresh button remains available after transient network failures. */ }
}, 30000)
onBeforeUnmount(() => { revision++; clearInterval(activityTimer) })
async function load() {
  const request = ++revision
  if (!user.value?.isAdmin) { rows.value = []; stats.value = {}; return }
  loading.value = true; error.value = ''; rows.value = []
  try {
    const [overview, page, trend] = await Promise.all([
      siteApi<Record<string, number>>('/admin/overview'),
      siteApi<Page<RecordRow>>(`/admin/${tab.value}?${new URLSearchParams({ offset: String(offset.value), q: filter.value, state: accountState.value })}`),
      siteApi<typeof activity.value>('/admin/activity'),
    ])
    if (request === revision) { stats.value = overview; rows.value = page.items; total.value = page.total; activity.value = trend }
  } catch (cause) { if (request === revision) error.value = cause instanceof Error ? cause.message : '后台加载失败' }
  finally { if (request === revision) loading.value = false }
}
watch([tab, filter, accountState], () => { offset.value = 0; void load() })
watch(offset, () => void load())
watch(() => user.value?.isAdmin, () => { pending.value = undefined; void load() }, { immediate: true })
function ask(row: RecordRow, action: 'delete' | 'pin' | 'suspend' | 'block') {
  reason.value = ''; actionError.value = ''
  const id = encodeURIComponent(row.id)
  if (action === 'delete') pending.value = { label: '删除话题', path: `/admin/${tab.value}/${id}`, method: 'DELETE', detail: '删除话题将同时删除其全部回复，无法恢复。' }
  if (action === 'pin') pending.value = { label: row.pinned ? '取消置顶' : '置顶话题', path: `/admin/topics/${id}/pin`, method: 'PUT', values: { pinned: !row.pinned }, detail: row.title || '' }
  if (action === 'suspend') pending.value = { label: row.suspended ? '解除封禁' : '封禁账号', path: `/admin/users/${id}/suspension`, method: 'PUT', values: { suspended: !row.suspended }, detail: `${row.email || row.id}。封禁会使已有登录失效；解除后需要重新登录。` }
  if (action === 'block') pending.value = { label: row.blocked ? '解除下架' : '下架作品', path: `/admin/publications/${id}/moderation`, method: 'PUT', values: { blocked: !row.blocked }, detail: `${row.title}。下架后公开入口和游戏包不可访问，作者无法重新发布；解除后已发布的作品恢复可见。` }
}
async function confirm() {
  if (!pending.value || saving.value || !reason.value.trim()) return
  saving.value = true; actionError.value = ''
  try {
    await siteApi(pending.value.path, pending.value.method, { ...pending.value.values, reason: reason.value.trim() })
    emit('notify', `${pending.value.label}成功，已记录操作原因`)
    pending.value = undefined
    await load()
  } catch (cause) { actionError.value = cause instanceof Error ? cause.message : '操作失败，请重试' }
  finally { saving.value = false }
}
function duration(value: number) { const seconds = Math.max(0, Math.floor(value)); return seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分` }
function statValue(key: string, value: number) { return key.endsWith('Seconds') ? duration(value) : value.toLocaleString('zh-CN') }
</script>

<template>
  <main id="main-content" class="page admin-page">
    <template v-if="user?.isAdmin">
      <div class="page-topline"><div class="page-intro"><span class="eyebrow">COMMUNITY & OPERATIONS</span><h1><ShieldCheck :size="32" /> 管理后台<span class="green-dot">.</span></h1><p>查看站点数据，维护创作空间。每项管理操作都会记录原因。</p></div><button class="button" :disabled="loading" @click="load"><RefreshCw :size="16" />刷新数据</button></div>
      <section class="admin-stats" aria-label="站点数据"><div v-for="(label, key) in statLabels" :key="key" class="admin-stat"><span>{{ label }}</span><strong>{{ stats[key] === undefined ? '—' : statValue(key, stats[key]!) }}</strong></div></section>
      <p class="activity-note">在线时长按前台页面心跳估算，同一账号多标签页不重复计时；离线最多约 60 秒后更新。统计从功能上线起累计，日期按北京时间。</p>
      <details class="activity-trend"><summary>近 14 天活跃趋势 · 近 7 天 {{ stats.weeklyActiveUsers || 0 }} 人活跃</summary><div class="activity-table"><table><thead><tr><th>日期</th><th>新增注册</th><th>活跃人数</th><th>在线时长</th></tr></thead><tbody><tr v-for="day in activity" :key="day.day"><td>{{ day.day }}</td><td>{{ day.registrations }}</td><td>{{ day.activeUsers }}</td><td>{{ duration(day.onlineSeconds) }}</td></tr></tbody></table></div></details>
      <nav class="admin-tabs" aria-label="管理分类"><button v-for="item in tabs" :key="item.id" :aria-pressed="tab === item.id" :class="{ active: tab === item.id }" @click="tab = item.id"><component :is="item.icon" :size="17" />{{ item.label }}</button></nav>
      <section class="admin-panel" :aria-label="heading">
        <div class="admin-toolbar"><h2>{{ heading }} <span>{{ total }} 条</span></h2><label v-if="tab === 'users'" class="account-state-label">账号状态<select v-model="accountState" class="text-input" aria-label="筛选账号状态"><option value="all">全部账号</option><option value="active">正常账号</option><option value="suspended">已封禁账号</option></select></label><form class="admin-search" @submit.prevent="filter = query.trim()"><label for="admin-search" class="sr-only">搜索{{ heading }}</label><input id="admin-search" v-model="query" class="text-input" maxlength="100" :placeholder="tab === 'users' ? '搜索邮箱或账号 ID' : '搜索内容'" /><button class="button" aria-label="搜索"><Search :size="17" /></button></form></div>
        <p v-if="error" class="danger-text" role="alert">{{ error }} <button class="button" @click="load">重试</button></p>
        <p v-if="loading" role="status">正在加载管理数据…</p>
        <p v-else-if="!error && !rows.length" class="admin-empty">暂无符合条件的记录。</p>
        <article v-for="row in rows" :key="row.id" class="admin-row">
          <div class="admin-record">
            <template v-if="tab === 'users'"><UserIdentity :id="row.id" :name="row.displayName || `创作者 ${row.id.slice(0, 8)}`" :avatar-url="row.avatarVersion ? `/v1/users/${row.id}/avatar?v=${row.avatarVersion}` : null" :is-admin="Boolean(row.isAdmin)" /><span v-if="row.suspended" class="admin-tag warning">已封禁</span><span v-else-if="row.online" class="admin-tag">在线</span><p>{{ row.email || '未绑定邮箱的旧账号' }} · 注册于 {{ communityTime(row.createdAt || '') }}</p><p>累计在线 {{ duration(row.onlineSeconds || 0) }} · {{ row.lastSeenAt ? `最近活跃 ${communityTime(new Date(row.lastSeenAt * 1000).toISOString())}` : '尚无活跃记录' }}</p><small>{{ row.id }}</small></template>
            <template v-else-if="tab === 'topics'"><h3><AppLink :href="`/community/${row.id}`">{{ row.title }}</AppLink><span v-if="row.pinned" class="admin-tag">已置顶</span></h3><p><UserIdentity :id="row.ownerId" :name="row.authorName || row.author || '创作者'" :is-admin="Boolean(row.authorIsAdmin)" :show-avatar="false" /> · {{ row.category }} · {{ row.replies }} 条回复</p><details><summary>查看正文</summary><p class="admin-content">{{ row.content }}</p></details></template>

            <template v-else-if="tab === 'publications'"><h3>{{ row.title }}<span class="admin-tag" :class="{ warning: row.blocked }">{{ row.blocked ? '已下架' : row.status === 'published' ? '已发布' : row.status === 'pending' ? '打包中' : row.status === 'failed' ? '发布失败' : '未发布' }}</span></h3><p><UserIdentity :id="row.ownerId" :name="row.authorName || row.author || '创作者'" :is-admin="Boolean(row.authorIsAdmin)" :show-avatar="false" /></p><p v-if="row.blocked" class="admin-content">下架原因：{{ row.reason }}</p><p v-else class="admin-content">{{ row.description }}</p><AppLink v-if="!row.blocked && row.status === 'published'" class="text-link" :href="`/play/${row.id}`">查看作品</AppLink></template>
            <template v-else><h3>{{ actionLabels[row.action || ''] || row.action }}</h3><p><AppLink :href="`/users/${row.ownerId}`">{{ row.authorName || row.actor }}</AppLink> · {{ communityTime(row.createdAt || '') }}</p><p class="admin-content">{{ row.reason }}</p><small>对象：{{ row.targetId }}</small></template>
          </div>
          <div class="admin-actions"><template v-if="tab === 'users' && !row.isAdmin"><button class="button" @click="ask(row, 'suspend')">{{ row.suspended ? '解除封禁' : '封禁账号' }}</button></template><template v-if="tab === 'topics'"><button class="button" @click="ask(row, 'pin')"><Pin :size="14" />{{ row.pinned ? '取消置顶' : '置顶' }}</button><button class="button danger-text" @click="ask(row, 'delete')"><Trash2 :size="14" />删除话题</button></template><button v-if="tab === 'publications'" class="button" @click="ask(row, 'block')">{{ row.blocked ? '解除下架' : '下架作品' }}</button></div>
        </article>
        <div v-if="total > 50" class="admin-pagination"><button class="button" :disabled="loading || offset === 0" @click="offset -= 50">上一页</button><span>{{ offset + 1 }}–{{ Math.min(offset + 50, total) }} / {{ total }}</span><button class="button" :disabled="loading || offset + 50 >= total" @click="offset += 50">下一页</button></div>
      </section>
      <AppModal v-if="pending" :title="pending.label" @close="!saving && (pending = undefined)"><p class="dialog-description">{{ pending.detail }}</p><form @submit.prevent="confirm"><label class="field-label" for="moderation-reason">操作原因（必填）</label><textarea id="moderation-reason" v-model="reason" class="text-input" required maxlength="500" rows="4" autofocus placeholder="说明处理原因，方便后续核查" /><p v-if="actionError" class="danger-text" role="alert">{{ actionError }}</p><div class="dialog-actions"><button type="button" class="button" :disabled="saving" @click="pending = undefined">取消</button><button class="button button-primary" :disabled="saving || !reason.trim()">{{ saving ? '正在处理…' : `确认${pending.label}` }}</button></div></form></AppModal>
    </template>
    <div v-else class="admin-denied"><ShieldCheck :size="40" /><h1>需要管理员权限</h1><p>当前账号无法访问管理后台。</p><AppLink href="/" class="button">返回首页</AppLink></div>
  </main>
</template>

<style scoped>
.admin-page{max-width:1280px}.page-intro h1{display:flex;align-items:center;gap:8px}.admin-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:28px 0 32px}.admin-stat{background:#fcfbf8;border:1px solid #dedbd2;border-radius:12px;padding:20px}.admin-stat span{display:block;font-size:12px;color:#797266}.admin-stat strong{display:block;margin-top:9px;font-size:28px;font-weight:550}.admin-tabs{display:flex;gap:6px;overflow:auto;margin-bottom:18px}.admin-tabs button{display:flex;gap:8px;align-items:center;border:0;background:transparent;padding:12px 16px;white-space:nowrap;border-radius:8px;color:#625b51}.admin-tabs button.active{background:#e4eadf;color:#314c37}.admin-panel{border:1px solid #dedbd2;border-radius:14px;padding:24px;background:#fcfbf8}.admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-bottom:20px;border-bottom:1px solid #e4dfd6}.admin-toolbar h2{font-size:18px;margin:0}.admin-toolbar h2 span{font-size:12px;color:#80776c;margin-left:8px}.admin-search{display:flex;gap:7px;width:min(360px,55%)}.admin-search input{min-width:0}.admin-row{display:flex;justify-content:space-between;gap:24px;padding:22px 0;border-bottom:1px solid #e4dfd6}.admin-record{min-width:0;flex:1}.admin-record h3{font-size:15px;margin:0 0 8px;overflow-wrap:anywhere}.admin-record>p{font-size:12px;color:#797266;margin:8px 0}.admin-record small{color:#8a8175;font-size:11px;overflow-wrap:anywhere}.admin-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;font-size:14px!important;color:#494338!important;max-height:320px;overflow:auto}.admin-record details{font-size:12px;margin-top:10px}.admin-record summary{cursor:pointer;color:#8b543d}.admin-actions{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}.admin-tag{display:inline-block;font-size:11px;font-weight:400;background:#e4eadf;color:#36583f;border-radius:5px;padding:3px 7px;margin-left:10px}.admin-tag.warning{background:#f4e3d9;color:#995336}.admin-pagination{display:flex;gap:18px;justify-content:center;align-items:center;margin-top:24px;font-size:12px}.admin-empty{padding:50px 0;text-align:center;color:#80776c}.admin-denied{text-align:center;padding:100px 20px}.admin-denied h1{font-size:28px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.admin-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.admin-stat{padding:15px}.admin-stat strong{font-size:24px}.admin-panel{padding:16px}.admin-toolbar{align-items:stretch;flex-direction:column}.admin-search{width:100%}.admin-row{flex-direction:column;gap:14px}.admin-actions{justify-content:flex-end}.admin-tabs button{padding:10px}}
.activity-note{font-size:12px;color:#80776b;margin:-16px 0 24px;line-height:1.9}.activity-trend{margin-bottom:28px;border:1px solid #dedbd2;background:#fcfbf8;border-radius:12px;padding:18px}.activity-trend summary{font-size:13px;cursor:pointer}.activity-table{overflow:auto;margin-top:16px}.activity-table table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.activity-table th,.activity-table td{padding:12px;border-top:1px solid #e4dfd6;white-space:nowrap}.activity-table th{color:#817568;font-weight:500}.account-state-label{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.account-state-label select{min-width:120px}@media(max-width:1000px){.admin-toolbar{flex-wrap:wrap}}
</style>
