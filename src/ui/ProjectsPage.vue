<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Download, FileJson, FolderOpen, Gamepad2, Grid2X2, List, MoreHorizontal, Plus, Upload } from '@lucide/vue'
import { nowLabel, uid, type Project } from './data'
import { exportProject, readProjectFile } from './project-file'
import { readEngineProject, writeEngineProject } from '../engine/storage'
import type { RestoredProject } from '../engine/cloud'
import CloudProjects from './CloudProjects.vue'
import { useNavigation } from './navigation'
import AppLink from './AppLink.vue'
import AppModal from './AppModal.vue'
import ArtworkView from './ArtworkView.vue'
import EmptyState from './EmptyState.vue'
import SearchField from './SearchField.vue'
import TextLink from './TextLink.vue'

const props = defineProps<{ projects: Project[] }>()
const emit = defineEmits<{
  'update:projects': [projects: Project[]]
  create: []
  notify: [message: string]
}>()

const query = ref('')
const filter = ref('all')
const view = ref<'grid' | 'list'>('grid')
const action = ref<{ type: 'rename' | 'delete'; project: Project } | null>(null)
const name = ref('')
const fileInput = ref<HTMLInputElement>()
const cloudOpen = ref(false)
const navigate = useNavigation()
async function restoreCloud(restored: RestoredProject) {
  try {
    const id = uid()
    const project: Project = { id, name: restored.project.name, description: restored.project.description, template: restored.project.template, image: '', status: 'draft', updated: nowLabel() }
    await writeEngineProject(id, restored.document, restored.binding || null)
    setProjects(projects => [project, ...projects]); cloudOpen.value = false
    emit('notify', restored.binding ? '云端完整项目已恢复' : '历史修订已恢复为独立本地副本')
    navigate(`/editor/${id}`)
  } catch (error) { emit('notify', error instanceof Error ? error.message : '恢复失败，本地项目未更改') }
}
const filters = [['all', '全部项目'], ['draft', '草稿'], ['published', '展示草稿']]
const visible = computed(() => props.projects.filter(project =>
  (filter.value === 'all' || project.status === filter.value) &&
  project.name.toLowerCase().includes(query.value.trim().toLowerCase())))

function setProjects(update: (projects: Project[]) => Project[]) {
  emit('update:projects', update(props.projects))
}

async function duplicate(project: Project) {
  const copy: Project = { ...project, id: uid(), name: `${project.name} 副本`.slice(0, 32), status: 'draft', updated: nowLabel() }
  try {
    const engine = await readEngineProject(project.id)
    if (engine) await writeEngineProject(copy.id, engine)
    const scene = localStorage.getItem(`tomcat-ui-scene-${project.id}`)
    if (scene) localStorage.setItem(`tomcat-ui-scene-${copy.id}`, scene)
  } catch {
    emit('notify', '场景复制失败，请先导出原项目')
    return
  }
  setProjects(projects => [copy, ...projects])
  emit('notify', '已创建项目副本')
}

async function importFile(file: File) {
  if (file.size > 64 * 1024 * 1024) {
    emit('notify', '请选择不超过 64 MiB 的项目 JSON 文件')
    return
  }
  try {
    const imported = await readProjectFile(file)
    const id = uid()
    const project: Project = { id, ...imported.project, updated: nowLabel() }
    if (imported.engine) await writeEngineProject(id, imported.engine)
    if (imported.scene) localStorage.setItem(`tomcat-ui-scene-${id}`, JSON.stringify(imported.scene))
    setProjects(projects => [project, ...projects])
    emit('notify', '项目已导入到本地空间')
  } catch {
    emit('notify', '导入失败，请使用本站导出的项目 JSON，并确认浏览器允许本地存储')
  }
}

function selectImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void importFile(file)
  input.value = ''
}

function beginRename(project: Project) {
  name.value = project.name
  action.value = { type: 'rename', project }
}

function renameProject() {
  if (!action.value || action.value.type !== 'rename' || !name.value.trim()) return
  const id = action.value.project.id
  setProjects(projects => projects.map(project => project.id === id
    ? { ...project, name: name.value.trim(), updated: nowLabel() }
    : project))
  action.value = null
  emit('notify', '项目已重命名')
}

async function deleteProject() {
  if (!action.value) return
  const id = action.value.project.id
  try { await writeEngineProject(id) } catch { emit('notify', '项目文件删除失败，请重试'); return }
  setProjects(projects => projects.filter(project => project.id !== id))
  try { localStorage.removeItem(`tomcat-ui-scene-${id}`) } catch { /* Metadata removal can proceed. */ }
  action.value = null
  emit('notify', '项目已删除')
}
async function exportItem(project: Project) {
  try { await exportProject(project); emit('notify', '项目文件已导出') }
  catch (error) { emit('notify', error instanceof Error ? error.message : '导出失败') }
}
</script>

<template>
  <main id="main-content" class="page workspace-page">
    <div class="page-topline">
      <div class="page-intro"><span class="eyebrow">YOUR NEXT LITTLE WORLD</span><h1>我的项目<span class="green-dot">.</span></h1><p>从一个想法，到一个可以分享的世界。</p></div>
      <div class="page-actions"><button class="button" @click="cloudOpen = true">云端项目</button><button class="button" @click="fileInput?.click()"><Upload :size="16" />导入项目</button><button class="button button-primary" @click="emit('create')"><Plus :size="16" />新建项目</button></div>
    </div>
    <input ref="fileInput" class="sr-only" tabindex="-1" type="file" accept=".json,application/json" aria-label="导入 TomCat 项目 JSON" @change="selectImport" />
    <div class="workspace-note"><span class="note-icon"><FolderOpen :size="20" :stroke-width="1.5" /></span><div><strong>你的创作，从这里继续</strong><p>下方是此浏览器的项目副本。登录“云端项目”查看服务器列表和修订；编辑器关联云端后可同步完整项目。</p></div><span class="small-tag">本地工作空间</span></div>

    <div class="filter-bar project-filter">
      <div class="filter-tabs"><button v-for="item in filters" :key="item[0]" :class="{ active: filter === item[0] }" :aria-pressed="filter === item[0]" @click="filter = item[0]">{{ item[1] }}<span class="filter-count">{{ projects.filter(project => item[0] === 'all' || project.status === item[0]).length }}</span></button></div>
      <div class="filter-tools"><SearchField v-model="query" placeholder="搜索我的项目" /><div class="view-toggle"><button aria-label="网格视图" :aria-pressed="view === 'grid'" :class="{ active: view === 'grid' }" @click="view = 'grid'"><Grid2X2 :size="16" /></button><button aria-label="列表视图" :aria-pressed="view === 'list'" :class="{ active: view === 'list' }" @click="view = 'list'"><List :size="17" /></button></div></div>
    </div>

    <div v-if="visible.length" class="project-grid" :class="{ 'project-list': view === 'list' }">
      <article v-for="project in visible" :key="project.id" class="project-card">
        <AppLink class="project-cover" :href="`/editor/${project.id}`" :aria-label="`编辑${project.name}`"><ArtworkView :src="project.image" :alt="`${project.name}项目封面`" /><span class="project-template">{{ project.template === '2D' ? '2D 场景' : '空白项目' }}</span></AppLink>
        <div class="project-content">
          <div class="project-card-heading"><AppLink :href="`/editor/${project.id}`"><h3>{{ project.name }}</h3></AppLink><details class="project-menu"><summary class="icon-button" :aria-label="`${project.name}更多操作`"><MoreHorizontal :size="19" /></summary><div class="menu-options"><button @click="beginRename(project)">重命名</button><button @click="duplicate(project)">创建副本</button><button @click="exportItem(project)">导出项目</button><button class="danger-text" @click="action = { type: 'delete', project }">删除项目</button></div></details></div>
          <p class="project-description">{{ project.description || '一个新的好玩想法。' }}</p>
          <div class="project-status-row"><span class="status-pill" :class="{ 'status-published': project.status === 'published' }"><span />{{ project.status === 'published' ? '本地展示草稿' : '草稿' }}</span><span>{{ project.updated }}</span></div>
          <div class="project-card-footer"><AppLink v-if="project.status === 'published'" class="text-link" :href="`/preview/${project.id}`">查看展示草稿</AppLink><span v-else><FileJson :size="13" />本地项目</span><AppLink :href="`/editor/${project.id}`" class="text-link">打开编辑器<ArrowUpRight :size="15" /></AppLink></div>
        </div>
      </article>
    </div>
    <EmptyState v-else :title="query ? '没有找到这个项目' : '这里还没有项目'" :text="query ? '试试其他名称，或清空搜索。' : '把脑海里的第一个画面，变成一个新项目。'"><button class="button button-primary" @click="emit('create')"><Plus :size="16" />新建项目</button></EmptyState>
    <div class="workspace-help"><span><Gamepad2 :size="18" />还不知道从哪里开始？</span><TextLink href="/community">看看大家正在做什么</TextLink></div>

    <CloudProjects v-if="cloudOpen" allow-restore @close="cloudOpen = false" @restored="restoreCloud" />
    <AppModal v-if="action" :title="action.type === 'rename' ? '给项目换个名字' : '删除这个项目？'" @close="action = null">
      <form v-if="action.type === 'rename'" @submit.prevent="renameProject"><label class="field-label" for="rename-project">项目名称</label><input id="rename-project" v-model="name" class="text-input" autofocus required maxlength="32" /><div class="dialog-actions"><button type="button" class="button" @click="action = null">取消</button><button class="button button-primary" :disabled="!name.trim()">保存名称</button></div></form>
      <template v-else><p class="dialog-description delete-description">“{{ action.project.name }}”将从此浏览器移除。删除后无法恢复，建议先导出项目备份。</p><div class="dialog-actions"><button class="button" @click="exportItem(action.project)"><Download :size="15" />先导出</button><button class="button" @click="action = null">取消</button><button class="button button-danger" @click="deleteProject">删除项目</button></div></template>
    </AppModal>
  </main>
</template>
