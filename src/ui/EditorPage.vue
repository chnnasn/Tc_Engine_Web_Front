<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EngineSurface from './EngineSurface.vue'
import { useNavigation } from './navigation'
import { nowLabel, type Project } from './data'
import { EngineError, type Snapshot, type SceneState } from '../engine/protocol'
import { readEngineProject, writeEngineProject, readCloudBinding, writeCloudBinding, engineCommit, type CloudBinding, type EngineDocument } from '../engine/storage'
import { currentUser, getCloudProject, createCloudProject, restoreCloudProject, saveCloudProject, syncConfiguration, cloudSyncStatus, CloudError } from '../engine/cloud'
import AgentPanel from './AgentPanel.vue'
import ScriptPanel from './ScriptPanel.vue'
import { describeSync, type CheckpointReceipt } from '../engine/sync-status'
import { downloadProject } from './project-file'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ updateProject: [project: Project]; notify: [message: string]; dirtyChange: [dirty: boolean] }>()
const navigate = useNavigation()
const surface = ref<InstanceType<typeof EngineSurface>>()
const scriptPanel = ref<InstanceType<typeof ScriptPanel>>()
const leaving = ref(false)
// 重建引擎会话：browser-wasm 无法在同一模块内替换 C# 程序集，改换 key 让宿主 iframe 重新挂载。
const surfaceKey = ref(0)
const stored = ref<EngineDocument>()
const initialized = ref(false)
const failure = ref('')
const snapshot = ref<Snapshot>()
const status = ref<SceneState>()
const saving = ref(false)
const saveActivity = ref<'automatic' | 'manual' | 'checkpoint' | ''>('')
const manualSavePending = ref(false)
// Background capture/upload still holds the serialization lock, but never dims the toolbar.
const toolbarSaving = computed(() => manualSavePending.value || saveActivity.value === 'manual' || saveActivity.value === 'checkpoint')
const automaticSaveVisible = ref(false)
let automaticSaveTimer: ReturnType<typeof setTimeout> | undefined
watch(saveActivity, activity => {
  clearTimeout(automaticSaveTimer)
  automaticSaveVisible.value = false
  if (activity === 'automatic') automaticSaveTimer = setTimeout(() => { automaticSaveVisible.value = true }, 350)
}, { flush: 'sync' })
const legacy = ref(false)
const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const agentOpen = ref(false)
const agentTrigger = ref<HTMLButtonElement>()
function collapseAgent() { agentOpen.value = false; agentTrigger.value?.focus() }
const scriptOpen = ref(false)
const scriptVisited = ref(false)
const scriptTrigger = ref<HTMLButtonElement>()
function toggleScript() {
  scriptVisited.value = true
  scriptOpen.value = !scriptOpen.value
  if (scriptOpen.value) agentOpen.value = false
}
function toggleAgent() {
  agentOpen.value = !agentOpen.value
  if (agentOpen.value) scriptOpen.value = false
}
function collapseScript() { scriptOpen.value = false; scriptTrigger.value?.focus() }
const binding = ref<CloudBinding>()
let gone = false
let syncTimer: ReturnType<typeof setTimeout> | undefined
const automaticSync = ref(false)
const syncMessage = ref('')
let syncedDocument = ''
let draftDocument = ''
let syncBlocked = false
let syncConfigLoaded = false
async function pollSync() {
  try {
    if (!gone && binding.value && !syncConfigLoaded) {
      automaticSync.value = (await syncConfiguration()).enabled
      syncConfigLoaded = true
    }
    if (!gone && !leaving.value && automaticSync.value && binding.value && editing.value && !busy.value && !saving.value && !manualSavePending.value) await save(true)
  } catch (error) { syncMessage.value = error instanceof Error ? error.message : String(error) }
  finally { if (!gone) syncTimer = setTimeout(pollSync, syncConfigLoaded ? 2000 : 10000) }
}
const needsSave = ref(false)
const scriptDraftDirty = ref(false)
const dirty = computed(() => scriptDraftDirty.value || needsSave.value || Boolean(status.value?.dirty))
watch(dirty, value => emit('dirtyChange', value))
const saveStatus = computed(() => {
  if (scriptDraftDirty.value) return '脚本有未保存的修改'
  if (automaticSaveVisible.value) return '自动保存中…'
  if (manualSavePending.value && saveActivity.value !== 'manual') return '等待当前同步完成…'
  if (saveActivity.value === 'manual') return '保存中…'
  if (saveActivity.value === 'checkpoint') return '正在保存 AI 检查点…'
  if (dirty.value && ['已保存到数据库', '已自动保存到数据库', 'AI 任务检查点已保存到数据库'].includes(syncMessage.value)) return '有未保存的修改'
  return syncMessage.value || (dirty.value ? '有未保存的修改' : binding.value ? '已关联云端' : '正在关联云端…')
})
const editing = computed(() => Boolean(status.value) && (!status.value?.mode || status.value.mode === 'edit'))
const selected = computed(() => snapshot.value?.entities.find(entity => entity.id === status.value?.selectedEntityId))
// Native hierarchy edits do not pass through the webpage's transaction helpers.
watch([scriptOpen, () => status.value?.revision, () => status.value?.selectedEntityId], async () => {
  if (scriptOpen.value && surface.value && status.value && !gone) {
    try { await refresh() } catch { /* The next native state change retries after an active edit. */ }
  }
})
function report(error: unknown) { emit('notify', error instanceof Error ? error.message : String(error)) }
function updateStatus(next: SceneState) {
  // scene.snapshot 不返回 mode（只有 EditorState/Status 才有）。刷新快照后若直接
  // 覆盖 status，会把 play/pause 模式清掉。保留上一次已知的模式，
  // 真正的模式变化由 iframe 每 ~100ms 推送的 state 事件纠正。
  const mode = next.mode ?? status.value?.mode
  status.value = mode ? { ...next, mode } : next
  emit('dirtyChange', dirty.value)
}
function agentState(next: Snapshot) { snapshot.value = next; updateStatus(next) }
async function agentCall<T = any>(type: string, payload?: unknown): Promise<T> {
  if (!surface.value || gone) throw new Error('编辑器尚未就绪')
  if (type === 'projectSyncStatus') {
    if (!binding.value) throw new Error('请先关联云端项目')
    if (saving.value) throw new EngineError('SAVE_IN_PROGRESS', '正在同步，请稍后重新查询')
    const link = { ...binding.value }
    const before = await surface.value.call<{ document: EngineDocument; state: SceneState }>('capture')
    const cloud = await cloudSyncStatus(link.projectId)
    const after = await surface.value.call<{ document: EngineDocument; state: SceneState }>('capture')
    if (binding.value?.projectId !== link.projectId || binding.value.etag !== link.etag || saving.value) throw new EngineError('SAVE_IN_PROGRESS', '同步状态已变化，请重新查询')
    return { ...describeSync({ etag: link.etag, matches: JSON.stringify(after.document) === syncedDocument,
      changedDuringQuery: JSON.stringify(before.document) !== JSON.stringify(after.document), blocked: syncBlocked }, cloud),
      projectId: link.projectId, sceneVersion: `${after.state.sceneHandle}:${after.state.revision}` } as T
  }
  return surface.value.call<T>(type, payload)
}
function markDirty() { needsSave.value = true; emit('dirtyChange', true) }
async function scriptCall<T = any>(type: string, payload?: unknown): Promise<T> {
  if (!surface.value || gone) throw new Error('编辑器尚未就绪')
  return surface.value.call<T>(type, payload)
}
/**
 * 重建引擎会话：先抓取当前项目，再让宿主 iframe 重新挂载。
 * 新模块启动时会带着这份文档恢复场景，随后可重新编译并安装最新 C# 脚本。
 */
async function restartSession() {
  await run(async () => {
    if (!surface.value) return
    const captured = await surface.value.call<{ document: EngineDocument; state: SceneState }>('capture')
    stored.value = captured.document
    needsSave.value = true; emit('dirtyChange', true)
    status.value = undefined
    surfaceKey.value += 1
    emit('notify', '正在重建引擎会话并恢复项目…')
  })
}
async function checkpoint(runId: string, phase: 'start' | 'end', signal: AbortSignal): Promise<CheckpointReceipt> {
  // Serialize with manual and automatic saves without silently skipping a required checkpoint.
  const deadline = Date.now() + 65000
  while (saving.value) {
    signal.throwIfAborted()
    if (Date.now() > deadline) throw new Error('等待保存超时，尚未建立检查点')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  signal.throwIfAborted()
  if (gone || !surface.value || !binding.value) throw new Error('编辑器或云端关联不可用')
  saving.value = true
  saveActivity.value = 'checkpoint'
  try {
    const link = { ...binding.value }
    const captured = await surface.value.call<{ document: EngineDocument; state: SceneState }>('capture')
    if (captured.state.mode && captured.state.mode !== 'edit') throw new Error('请先停止运行预览，再建立任务检查点')
    const metadata = { runId, phase, sceneVersion: `${captured.state.sceneHandle}:${captured.state.revision}` }
    binding.value = { ...link, pending: true }
    needsSave.value = true; emit('dirtyChange', true)
    await writeEngineProject(props.project.id, captured.document, { ...binding.value })
    draftDocument = JSON.stringify(captured.document)
    signal.throwIfAborted()
    const saved = await saveCloudProject(captured.document, link, { reuseUploads: true, checkpoint: metadata })
    // If cancellation arrived during upload, still retain the acknowledged ETag locally.
    binding.value = saved
    await writeEngineProject(props.project.id, captured.document, { ...saved })
    syncedDocument = JSON.stringify(captured.document); stored.value = captured.document; syncBlocked = false
    let current = false
    if (!gone) {
      try {
        const next = await surface.value!.call<Snapshot>('markSaved', captured)
        needsSave.value = false; snapshot.value = next; updateStatus(next); current = true
      } catch (error) {
        if (!(error instanceof EngineError && error.code === 'REVISION_CONFLICT')) throw error
      }
    }
    syncMessage.value = current ? 'AI 任务检查点已保存到数据库' : '检查点已落库，当前场景还有新修改'
    return { ...metadata, revisionId: saved.etag!.slice(1, -1), persisted: true, current }
  } catch (error) {
    if (error instanceof CloudError && [401, 412].includes(error.status)) syncBlocked = true
    throw error
  } finally { saving.value = false; saveActivity.value = '' }
}
async function refresh() {
  if (!surface.value) return
  snapshot.value = await surface.value.call<Snapshot>('snapshot')
}
async function ready(next?: Snapshot) {
  if (!next) return
  snapshot.value = next; needsSave.value = !stored.value || Boolean(binding.value?.pending); updateStatus(next)
}
async function run(action: () => Promise<unknown>) {
  if (busy.value || gone) return
  busy.value = true
  try { await action() }
  catch (error) {
    if (error instanceof EngineError && error.code === 'REVISION_CONFLICT') {
      try { await refresh() } catch { /* Keep original diagnostic. */ }
      emit('notify', '场景已变化，请检查最新内容后重试')
    } else if (error instanceof EngineError && error.code === 'SESSION_RESTART_REQUIRED') {
      // 脚本改过但本会话已装过程序集：引导用户到脚本面板重建会话。
      scriptOpen.value = true
      scriptVisited.value = true
      agentOpen.value = false
      emit('notify', error.message)
    } else report(error)
  } finally { busy.value = false }
}
async function waitForSave() {
  const deadline = Date.now() + 65000
  while (saving.value) {
    if (gone) throw new Error('编辑器已关闭')
    if (Date.now() > deadline) throw new Error('等待同步超时，请稍后重试')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (gone) throw new Error('编辑器已关闭')
}
async function requestSave() {
  if (manualSavePending.value || gone || !surface.value) return
  manualSavePending.value = true
  try { await waitForSave(); await scriptPanel.value?.flushDraft(); await save() }
  catch (error) { if (!gone) report(error) }
  finally { manualSavePending.value = false }
}
async function save(automatic = false): Promise<boolean> {
  if (saving.value || gone || !surface.value) return false
  saving.value = true
  if (!automatic) saveActivity.value = 'manual'
  try {
    const captured = await surface.value.call<{ document: EngineDocument; state: SceneState }>('capture')
    const serialized = JSON.stringify(captured.document)
    if (automatic && syncBlocked && binding.value) {
      if (serialized !== draftDocument) {
        binding.value = { ...binding.value, pending: true }
        await writeEngineProject(props.project.id, captured.document, { ...binding.value })
        draftDocument = serialized
        needsSave.value = true; emit('dirtyChange', true)
      }
      return true
    }
    if (automatic && serialized === syncedDocument) {
      if (binding.value && dirty.value) {
        const current = await cloudSyncStatus(binding.value.projectId)
        if (current.etag !== binding.value.etag) throw new CloudError(412, '云端已有新修订，本地内容已保留。请恢复最新版本比较，或另建云端项目')
        if (current.persisted) {
          const next = await surface.value.call<Snapshot>('markSaved', captured)
          needsSave.value = false; snapshot.value = next; updateStatus(next)
          syncMessage.value = '已自动保存到数据库'
        }
      }
      return true
    }
    if (binding.value) {
      // Polling an unchanged scene is not a save; only announce actual automatic writes.
      if (automatic) saveActivity.value = 'automatic'
      needsSave.value = true; emit('dirtyChange', true)
      binding.value = { ...binding.value, pending: true }
      // Keep a local draft before network I/O; the cloud ETag is never advanced on failure.
      await writeEngineProject(props.project.id, captured.document, { ...binding.value })
      draftDocument = serialized
      binding.value = await saveCloudProject(captured.document, { ...binding.value }, { automatic, reuseUploads: automaticSync.value })
      await writeEngineProject(props.project.id, captured.document, { ...binding.value })
    } else throw new Error('编辑器必须关联云端项目后才能保存')
    syncedDocument = serialized
    if (gone) return false
    stored.value = captured.document
    if (automatic) {
      syncMessage.value = '已同步，等待定期落库'
      return true
    }
    syncMessage.value = binding.value ? '已保存到数据库' : ''
    syncBlocked = false
    // A concurrent native edit must not be marked saved by an older IndexedDB write.
    const next = await surface.value.call<Snapshot>('markSaved', captured)
    needsSave.value = false; snapshot.value = next; updateStatus(next)
    emit('updateProject', { ...props.project, updated: nowLabel() })
    emit('notify', '完整项目已保存到云端')
    return true
  } catch (error) {
    if (!gone) {
      if (automatic) {
        syncMessage.value = error instanceof Error ? error.message : String(error)
        if (error instanceof CloudError && [401, 412].includes(error.status)) syncBlocked = true
      } else report(error)
    }
    return false
  }
  finally { saving.value = false; saveActivity.value = '' }
}
async function exportCurrent() {
  await run(async () => {
    const captured = await surface.value!.call<{ document: EngineDocument }>('capture')
    downloadProject(props.project, captured.document)
  })
}
function actions(bits: number) {
  if (bits & 1) void requestSave()
  if (bits & 2) { emit('notify', '请点击“导入图片”选择文件'); fileInput.value?.click() }
  if (bits & 4) void exportCurrent()
}
async function importImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  await run(async () => {
    if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2 MiB')
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'tga'].includes(extension || '')) throw new Error('请选择 PNG/JPEG/TGA 图片')
    await surface.value!.call('importImage', { name: `${crypto.randomUUID()}.${extension}`, bytes: new Uint8Array(await file.arrayBuffer()) })
    needsSave.value = true; emit('dirtyChange', true)
    emit('notify', '图片已导入，请保存项目')
  })
}
async function prepareLeave(): Promise<boolean> {
  surface.value?.saveLayout()
  if (!status.value || failure.value || !surface.value) return true
  if (leaving.value || busy.value) return false
  leaving.value = true
  try {
    await waitForSave()
    await scriptPanel.value?.flushDraft()
    if (status.value.mode && status.value.mode !== 'edit') await surface.value.call('preview', { command: 'stop' })
    // Persist an immediate revision, including any pending Redis working state.
    return await save()
  } catch (error) { report(error); return false }
  finally { leaving.value = false }
}
function beforeUnload(event: BeforeUnloadEvent) {
  surface.value?.saveLayout()
  // Browser shutdown cannot await cloud uploads. Keep the unsaved-change guard.
  if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = '' }
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void requestSave() }
}
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keydown)
  try {
    const user = await currentUser()
    if (gone) return
    binding.value = await readCloudBinding(props.project.id)
    if (binding.value && binding.value.ownerId !== user.id) throw new Error('此项目属于其他账号，请切换账号后打开')
    if (!binding.value) {
      const cloud = await createCloudProject(props.project)
      if (gone) return
      binding.value = { ownerId: user.id, projectId: cloud.id, etag: null, pending: true }
      await writeCloudBinding(props.project.id, { ...binding.value })
    }
    const cloud = await getCloudProject(binding.value.projectId)
    if (gone) return
    stored.value = await readEngineProject(props.project.id)
    if (!stored.value && cloud.currentRevisionId) {
      const restored = await restoreCloudProject(cloud.id)
      stored.value = restored.document
      binding.value = restored.binding!
      await writeEngineProject(props.project.id, restored.document, { ...binding.value })
    }
    binding.value = await readCloudBinding(props.project.id)
    if (!gone) { initialized.value = true; syncTimer = setTimeout(pollSync, 2000) }
  } catch (error) { failure.value = error instanceof Error ? error.message : String(error) }
})
onBeforeUnmount(() => { gone = true; clearTimeout(syncTimer); clearTimeout(automaticSaveTimer); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keydown); emit('dirtyChange', false) })
defineExpose({ prepareLeave })
</script>
<template>
  <main id="main-content" class="native-editor">
    <header class="native-toolbar">
      <button class="button" :disabled="leaving" @click="navigate('/projects')">返回项目</button>
      <div class="editor-project-info"><strong class="editor-project-name" :title="project.name">{{ project.name }}</strong><span class="editor-save-status" role="status" :title="saveStatus">{{ saveStatus }}</span></div>
      <button class="button" :disabled="!editing || busy" @click="fileInput?.click()">导入图片</button>
      <button class="button" :disabled="!status || busy" @click="exportCurrent">导出项目</button>
      <button ref="scriptTrigger" class="button" :class="{ 'agent-active': scriptOpen }" :disabled="!status" :aria-expanded="scriptOpen" aria-controls="editor-script-panel" @click="toggleScript">C# 脚本</button>
      <button ref="agentTrigger" class="button" :class="{ 'agent-active': agentOpen }" :disabled="!status" :aria-expanded="agentOpen" aria-controls="editor-agent-panel" @click="toggleAgent">AI 助手</button>
      <button class="button button-primary editor-save-button" :disabled="!status || toolbarSaving" @click="requestSave()">保存到云端</button>
      <input ref="fileInput" hidden type="file" accept=".png,.jpg,.jpeg,.tga" @change="importImage" />
    </header>

    <div v-if="failure" class="native-notice" role="alert">{{ failure }}</div>
    <div class="editor-workspace">
    <EngineSurface v-if="initialized && !failure" :key="surfaceKey" ref="surface" kind="editor" :name="project.name" :template="project.template" :document="stored" :cloud-project-id="binding?.projectId" @ready="ready" @state="updateStatus" @actions="actions" @error="failure = $event" />
    <div v-else-if="!failure" class="native-notice">正在读取项目…</div>
    <ScriptPanel ref="scriptPanel" v-if="scriptVisited && status && !failure" v-show="scriptOpen" class="editor-floating editor-floating-scripts" :visible="scriptOpen" :call="scriptCall" @collapse="collapseScript" @draft-change="scriptDraftDirty = $event" @notify="emit('notify', $event)" @dirty="markDirty" @restart="restartSession" />
    <AgentPanel v-if="status && !failure" v-show="agentOpen" class="editor-floating" :visible="agentOpen" :project-id="binding?.projectId" :call="agentCall" :checkpoint="checkpoint" @state="agentState" @collapse="collapseAgent" />
    <div v-if="leaving" class="editor-leaving" role="status">正在保存，完成后返回…</div>
    </div>
    <footer>{{ binding ? '已关联云端' : '正在验证云端关联' }} · {{ status?.mode === 'play' ? '运行中' : status?.mode === 'pause' ? '已暂停' : '编辑模式' }} · {{ snapshot?.schemas.length || 0 }} 种组件类型 <span v-if="selected"> · {{ selected.name }}</span><span>预览不会公开发布；停止预览后继续编辑</span></footer>
  </main>
</template>
<style scoped>
.native-editor{height:100dvh;display:flex;flex-direction:column;background:#202329;color:#e8eeee}.native-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;background:#f5f6f2;color:#24322b}.native-toolbar strong{margin-right:auto}.native-toolbar .button{padding:8px 12px;min-height:34px}.native-editor :deep(.engine-surface){flex:1;min-height:0}.native-notice{padding:14px 20px;background:#394039;color:#fff}.native-editor footer{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;padding:8px 16px;color:#bcc7c2}.native-editor footer span:last-child{margin-left:auto}
.editor-leaving{position:absolute;inset:0;z-index:30;display:grid;place-content:center;background:#202329cc;color:#fff;font-size:14px}
.editor-workspace{position:relative;display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}.editor-workspace :deep(.engine-surface){min-width:0}.native-toolbar .agent-active{background:#f0e5db;border-color:#b8866b;color:#88412d}
.editor-workspace>.editor-floating{position:absolute;z-index:10;top:0;right:0;bottom:0;width:390px;max-width:100%;min-width:0;height:auto;border:0;border-left:1px solid #d8d2c8;border-radius:0;box-shadow:-8px 0 24px #0003;overflow:hidden}
.editor-workspace>.editor-floating-scripts{width:620px}
</style>
<style scoped>
.editor-project-info{display:flex;align-items:center;gap:10px;flex:0 0 270px;max-width:calc(100% - 95px);min-width:0;margin-right:auto}
.native-toolbar .editor-project-name{flex:1;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.editor-save-status{flex:0 0 155px;min-width:0;color:#82796d;font-size:11px;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.native-toolbar .editor-save-button{width:100px;flex:0 0 100px}
</style>
