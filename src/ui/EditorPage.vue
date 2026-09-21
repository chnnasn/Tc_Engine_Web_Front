<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EngineSurface from './EngineSurface.vue'
import { useNavigation } from './navigation'
import { nowLabel, type Project } from './data'
import { EngineError, type Snapshot, type SceneState, type Operation } from '../engine/protocol'
import { readEngineProject, writeEngineProject, readCloudBinding, writeCloudBinding, type CloudBinding, type EngineDocument } from '../engine/storage'
import { currentUser, getCloudProject, createCloudProject, restoreCloudProject, saveCloudProject, syncConfiguration, cloudSyncStatus, CloudError } from '../engine/cloud'
import CloudProjects from './CloudProjects.vue'
import AgentPanel from './AgentPanel.vue'
import { describeSync, type CheckpointReceipt } from '../engine/sync-status'
import { downloadProject } from './project-file'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ updateProject: [project: Project]; notify: [message: string]; dirtyChange: [dirty: boolean] }>()
const navigate = useNavigation()
const surface = ref<InstanceType<typeof EngineSurface>>()
const stored = ref<EngineDocument>()
const initialized = ref(false)
const failure = ref('')
const snapshot = ref<Snapshot>()
const status = ref<SceneState>()
const saving = ref(false)
const legacy = ref(false)
const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const cloudOpen = ref(false)
const agentOpen = ref(false)
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
    if (!gone && automaticSync.value && binding.value && editing.value && !busy.value && !saving.value) await save(true)
  } catch (error) { syncMessage.value = error instanceof Error ? error.message : String(error) }
  finally { if (!gone) syncTimer = setTimeout(pollSync, syncConfigLoaded ? 2000 : 10000) }
}
const needsSave = ref(false)
const dirty = computed(() => needsSave.value || Boolean(status.value?.dirty))
const editing = computed(() => Boolean(status.value) && (!status.value?.mode || status.value.mode === 'edit'))
const selected = computed(() => snapshot.value?.entities.find(entity => entity.id === status.value?.selectedEntityId))
function report(error: unknown) { emit('notify', error instanceof Error ? error.message : String(error)) }
function updateStatus(next: SceneState) { status.value = next; emit('dirtyChange', needsSave.value || next.dirty) }
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
  } finally { saving.value = false }
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
    } else report(error)
  } finally { busy.value = false }
}
async function transaction(label: string, operations: Operation[]) {
  // Obtain a fresh authoritative snapshot; a native gesture can still reject with EDIT_IN_PROGRESS.
  await refresh()
  const next = await surface.value!.call<Snapshot>('transact', { state: snapshot.value, label, operations })
  snapshot.value = next; updateStatus(next)
}
function addEntity() {
  void run(async () => {
    const bits = crypto.getRandomValues(new Uint32Array(2))
    const id = ((BigInt(bits[0]!) << 32n) | BigInt(bits[1]!)).toString()
    await transaction('添加对象', [{ op: 'entity.create', entityId: id === '0' ? '1' : id, name: 'New Entity' }])
  })
}
function history(direction: 'undo' | 'redo') {
  void run(async () => {
    await refresh()
    const next = await surface.value!.call<Snapshot>('history', { state: snapshot.value, direction })
    snapshot.value = next; updateStatus(next)
  })
}
function preview(command: 'play' | 'pause' | 'resume' | 'step' | 'stop') {
  void run(async () => {
    await surface.value!.call('preview', { command })
    await refresh()
    updateStatus(snapshot.value!)
  })
}
async function save(automatic = false) {
  if (saving.value || gone || !surface.value) return
  saving.value = true
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
      return
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
      return
    }
    if (binding.value) {
      needsSave.value = true; emit('dirtyChange', true)
      binding.value = { ...binding.value, pending: true }
      // Keep a local draft before network I/O; the cloud ETag is never advanced on failure.
      await writeEngineProject(props.project.id, captured.document, { ...binding.value })
      draftDocument = serialized
      binding.value = await saveCloudProject(captured.document, { ...binding.value }, { automatic, reuseUploads: automaticSync.value })
      await writeEngineProject(props.project.id, captured.document, { ...binding.value })
    } else throw new Error('编辑器必须关联云端项目后才能保存')
    syncedDocument = serialized
    if (gone) return
    stored.value = captured.document
    if (automatic) {
      syncMessage.value = '已同步，等待定期落库'
      return
    }
    syncMessage.value = binding.value ? '已保存到数据库' : ''
    syncBlocked = false
    // A concurrent native edit must not be marked saved by an older IndexedDB write.
    const next = await surface.value.call<Snapshot>('markSaved', captured)
    needsSave.value = false; snapshot.value = next; updateStatus(next)
    emit('updateProject', { ...props.project, updated: nowLabel() })
    emit('notify', '完整项目已保存到云端')
  } catch (error) {
    if (!gone) {
      if (automatic) {
        syncMessage.value = error instanceof Error ? error.message : String(error)
        if (error instanceof CloudError && [401, 412].includes(error.status)) syncBlocked = true
      } else { report(error); if (error instanceof CloudError && error.status === 401) cloudOpen.value = true }
    }
  }
  finally { saving.value = false }
}
async function attachCloud(next: CloudBinding) {
  if (saving.value) return
  syncedDocument = ''; syncBlocked = false; syncMessage.value = ''; syncConfigLoaded = false
  try { await writeCloudBinding(props.project.id, next); binding.value = next; needsSave.value = true; emit('dirtyChange', true); cloudOpen.value = false; emit('notify', '已关联，请点击“保存到云端”上传完整项目') }
  catch (error) { report(error) }
}
async function exportCurrent() {
  await run(async () => {
    const captured = await surface.value!.call<{ document: EngineDocument }>('capture')
    downloadProject(props.project, captured.document)
  })
}
function actions(bits: number) {
  if (bits & 1) void save()
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
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
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
    legacy.value = !stored.value && Boolean(localStorage.getItem(`tomcat-ui-scene-${props.project.id}`))
    if (!gone) { initialized.value = true; syncTimer = setTimeout(pollSync, 2000) }
  } catch (error) { failure.value = error instanceof Error ? error.message : String(error) }
})
onBeforeUnmount(() => { gone = true; clearTimeout(syncTimer); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keydown); emit('dirtyChange', false) })
</script>
<template>
  <main id="main-content" class="native-editor">
    <header class="native-toolbar">
      <button class="button" @click="navigate('/projects')">返回项目</button>
      <strong>{{ project.name }}{{ dirty ? ' · 未保存' : '' }}</strong>
      <button class="button" :disabled="!editing || busy" @click="addEntity">添加对象</button>
      <button class="button" :disabled="!editing || !status?.canUndo || busy" @click="history('undo')">撤销</button>
      <button class="button" :disabled="!editing || !status?.canRedo || busy" @click="history('redo')">重做</button>
      <button v-if="editing" class="button" :disabled="busy || saving" @click="preview('play')">运行预览</button>
      <button v-if="status?.mode === 'play'" class="button" :disabled="busy || saving" @click="preview('pause')">暂停预览</button>
      <button v-if="status?.mode === 'pause'" class="button" :disabled="busy || saving" @click="preview('resume')">继续运行</button>
      <button v-if="status?.mode === 'pause'" class="button" :disabled="busy || saving" @click="preview('step')">单步运行</button>
      <button v-if="status && !editing" class="button" :disabled="busy || saving" @click="preview('stop')">停止预览</button>
      <button class="button" :disabled="!editing || busy" @click="fileInput?.click()">导入图片</button>
      <button class="button" :disabled="!status || busy" @click="exportCurrent">导出项目</button>
      <button class="button" :disabled="saving" @click="cloudOpen = true">云端</button>
      <button class="button" :disabled="!status" @click="agentOpen = !agentOpen">AI 助手</button>
      <button class="button button-primary" :disabled="!status || saving" @click="save()">{{ saving ? '保存中…' : '保存到云端' }}</button>
      <input ref="fileInput" hidden type="file" accept=".png,.jpg,.jpeg,.tga" @change="importImage" />
    </header>
    <AgentPanel v-if="agentOpen && status && !failure" :project-id="binding?.projectId" :call="agentCall" :checkpoint="checkpoint" @state="agentState" />
    <div v-if="legacy" class="native-notice">此项目含旧版界面原型数据，已原样保留。当前打开的是新的引擎场景；旧数据不会自动转换为游戏场景。</div>
    <div v-if="failure" class="native-notice" role="alert">{{ failure }}</div>
    <EngineSurface v-if="initialized && !failure" ref="surface" kind="editor" :name="project.name" :template="project.template" :document="stored" :cloud-project-id="binding?.projectId" @ready="ready" @state="updateStatus" @actions="actions" @error="failure = $event" />
    <div v-else-if="!failure" class="native-notice">正在读取项目…</div>
    <footer><span v-if="binding && syncMessage" role="status">{{ syncMessage }} · </span>{{ binding ? '已关联云端' : '正在验证云端关联' }} · {{ status?.mode === 'play' ? '运行中' : status?.mode === 'pause' ? '已暂停' : '编辑模式' }} · {{ snapshot?.schemas.length || 0 }} 种组件类型 <span v-if="selected"> · {{ selected.name }}</span><span>预览不会公开发布；停止预览后继续编辑</span></footer>
    <CloudProjects v-if="cloudOpen" :project="project" :binding="binding" @close="cloudOpen = false" @attach="attachCloud" />
  </main>
</template>
<style scoped>
.native-editor{height:100dvh;display:flex;flex-direction:column;background:#202329;color:#e8eeee}.native-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;background:#f5f6f2;color:#24322b}.native-toolbar strong{margin-right:auto}.native-toolbar .button{padding:8px 12px;min-height:34px}.native-editor :deep(.engine-surface){flex:1;min-height:0}.native-notice{padding:14px 20px;background:#394039;color:#fff}.native-editor footer{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;padding:8px 16px;color:#bcc7c2}.native-editor footer span:last-child{margin-left:auto}
</style>
