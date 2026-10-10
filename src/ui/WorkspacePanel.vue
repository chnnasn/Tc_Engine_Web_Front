<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { EngineCall } from '../engine/automation'
import type { Snapshot } from '../engine/protocol'
import type { EngineDocument } from '../engine/storage'
import { sceneDiff, fileDiff } from '../engine/semantic-diff'
import ChangeSummary from './ChangeSummary.vue'
const props = defineProps<{ projectId: string; call: EngineCall; baseline: Snapshot; baselineDocument?: EngineDocument; disabled?: boolean }>()
const emit = defineEmits<{ close: []; fork: [] }>()
const error = ref(''), busy = ref(false), diff = ref<ReturnType<typeof sceneDiff>>(), files = ref<ReturnType<typeof fileDiff>>([])
const entities = ref<Snapshot['entities']>([]), selected = ref(''), minimum = ref(-1), maximum = ref(1), steps = ref(180), tolerance = ref(0.02)
const report = ref<any>(), notes = ref<any[]>([]), key = ref(''), content = ref(''), version = ref(0)
const parent = ref<{ sourceProjectId: string | null; baseRevisionId: string }>()
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/v1/projects/${encodeURIComponent(props.projectId)}/${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-TomCat-Request': '1' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(response.status === 409 ? '笔记已被修改，请重新读取后再保存。' : '项目工具请求失败')
  return response.status === 204 ? undefined : response.json()
}
async function perform(action: () => Promise<void>) {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { busy.value = false }
}
async function refresh() {
  const state = await props.call<Snapshot>('snapshot')
  diff.value = sceneDiff(props.baseline, state)
  entities.value = state.entities
  if (!selected.value) selected.value = state.entities[0]?.id || ''
  if (props.baselineDocument && (!state.mode || state.mode === 'edit')) files.value = fileDiff(props.baselineDocument, (await props.call<{ document: EngineDocument }>('capture')).document)
  notes.value = (await api('ai-knowledge')).notes
  parent.value = await api('experiment')
}
async function validate() {
  report.value = undefined
  const state = await props.call<Snapshot>('snapshot')
  report.value = await props.call('runtimeValidate', { scene_version: `${state.sceneHandle}:${state.revision}`, steps: steps.value, sample_every: Math.max(1, Math.ceil(steps.value / 30)), checks: [{ entity_id: selected.value, axis: 'y', min: minimum.value, max: maximum.value, stable_tolerance: tolerance.value }] })
}
function edit(note?: any) { key.value = note?.key || ''; content.value = note?.content || ''; version.value = note?.version || 0 }
async function saveNote() {
  const result = await api('ai-knowledge', { method: 'PUT', body: JSON.stringify({ key: key.value, content: content.value, expectedVersion: version.value }) })
  version.value = result.data.version; await refresh()
}
onMounted(() => void perform(refresh))
</script>
<template>
  <aside class="workspace-panel" aria-label="项目工具">
    <header><strong>项目工具</strong><button @click="emit('close')">关闭</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="parent">试验副本 · 基线 {{ parent.baseRevisionId.slice(0, 8) }}。修改只保存到此副本。</p>
    <button :disabled="busy || disabled" @click="emit('fork')">创建试验副本</button>
    <p class="hint">复制完整场景、脚本与资源，保存为独立云端项目；打开后使用新的引擎会话。</p>
    <details open><summary>本次打开后的变化</summary><button :disabled="busy || disabled" @click="perform(refresh)">刷新差异与笔记</button><ChangeSummary v-if="diff" :diff="diff" /><ul><li v-for="file in files" :key="file.path">{{ file.change }} · {{ file.path }}</li></ul></details>
    <details><summary>固定步数位置验收</summary>
      <label>目标实体<select v-model="selected"><option v-for="entity in entities" :key="entity.id" :value="entity.id">{{ entity.name }} · {{ entity.id }}</option></select></label>
      <label>模拟步数（3–600）<input v-model.number="steps" type="number" min="3" max="600" /></label>
      <label>最终世界 Y 最小值<input v-model.number="minimum" type="number" step="any" /></label><label>最终世界 Y 最大值<input v-model.number="maximum" type="number" step="any" /></label>
      <label>最后三次采样的最大变化<input v-model.number="tolerance" type="number" min="0" step="any" /></label>
      <button :disabled="busy || disabled || !selected" @click="perform(validate)">运行位置验收</button>
      <p class="hint">从编辑模式开始，结束后自动停止。只检查采样位置，不判断脚本无异常、连续碰撞或游戏体验。</p>
      <p v-if="report" role="status">位置验收{{ report.passed ? '通过' : '未通过' }} · {{ report.steps }} 步</p><details v-if="report"><summary>检查与轨迹</summary><pre>{{ JSON.stringify(report, null, 2) }}</pre></details>
    </details>
    <details><summary>项目知识（{{ notes.length }}）</summary>
      <p class="hint">笔记是项目观察或约定，AI 会按需读取；来源记录不代表内容已验证。</p>
      <ul><li v-for="note in notes" :key="note.key"><button :disabled="busy" @click="edit(note)">{{ note.key }} · v{{ note.version }}</button><p>{{ note.content }}</p><small>{{ note.sourceRunId ? `来自任务 ${note.sourceRunId}` : '人工记录' }}</small></li></ul>
      <button :disabled="busy" @click="edit()">新建笔记</button>
      <label>标识（字母、数字、下划线或短横线）<input v-model="key" :disabled="version > 0" maxlength="64" /></label><label>内容<textarea v-model="content" maxlength="4000" rows="5" /></label>
      <button :disabled="busy || disabled || !key || !content.trim()" @click="perform(saveNote)">保存笔记</button>
    </details>
  </aside>
</template>
<style scoped>
.workspace-panel{padding:14px;overflow:auto!important;background:var(--editor-panel);color:var(--editor-text);font-size:12px}.workspace-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.workspace-panel details{margin:16px 0}.workspace-panel summary{cursor:pointer;margin-bottom:10px}.workspace-panel label{display:block;margin:10px 0}.workspace-panel input,.workspace-panel select,.workspace-panel textarea{box-sizing:border-box;display:block;width:100%;background:var(--editor-field);color:var(--editor-text);border:1px solid var(--editor-border);padding:6px}.workspace-panel button{padding:5px 8px;background:var(--editor-button);color:var(--editor-text);border:1px solid var(--editor-border)}.workspace-panel .hint,.workspace-panel small{color:var(--editor-muted);line-height:1.6}.workspace-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto}.workspace-panel li{overflow-wrap:anywhere}.workspace-panel p[role=alert]{color:var(--editor-warning)}
</style>
