<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { executeTool, type AutomationCommand, type EngineCall } from '../engine/automation'
import { engineCommit } from '../engine/storage'
import type { Snapshot } from '../engine/protocol'

const props = defineProps<{ projectId?: string; call: EngineCall }>()
const emit = defineEmits<{ state: [snapshot: Snapshot] }>()
const prompt = ref('')
const answer = ref('')
const error = ref('')
const running = ref(false)
const events = ref<string[]>([])
let sessionId: string | undefined
let controller: AbortController | undefined
let disposed = false
const headers = { 'Content-Type': 'application/json', 'X-TomCat-Request': '1' }
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/v1/editor-sessions${path}`, { ...options, headers, credentials: 'same-origin' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `编辑器服务请求失败 (${response.status})`)
  }
  return response.status === 204 ? undefined : response.json()
}
async function close() {
  const old = sessionId; sessionId = undefined
  controller?.abort(); controller = undefined
  if (old) await api(`/${old}`, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {})
}
async function poll(id: string, signal: AbortSignal) {
  try {
    while (!signal.aborted && id === sessionId) {
      const command = await api(`/${id}/commands`, { signal }) as AutomationCommand | undefined
      if (!command) continue
      if (signal.aborted || id !== sessionId) return
      events.value = [...events.value.slice(-19), `执行 ${command.name}`]
      const result = await executeTool(command, props.call, next => emit('state', next))
      if (signal.aborted || id !== sessionId) return
      await api(`/${id}/commands/${command.requestId}/result`, { method: 'POST', body: JSON.stringify(result), signal })
      events.value = [...events.value.slice(-19), result.ok ? `${command.name} 完成` : `${command.name}: ${result.error?.message}`]
    }
  } catch (cause) {
    if (!signal.aborted) {
      error.value = `编辑器连接中断，请检查场景后重试。${cause instanceof Error ? cause.message : ''}`
      await close()
    }
  }
}
async function send() {
  if (running.value || !prompt.value.trim() || !props.projectId) return
  running.value = true; error.value = ''; answer.value = ''; events.value = []
  try {
    // Each request is an isolated run; no shared conversation or credentials across editors.
    await close()
    const projectId = props.projectId
    controller = new AbortController()
    const signal = controller.signal
    const registered = await api('/', { method: 'POST', body: JSON.stringify({ projectId, engineCommit }), signal })
    sessionId = registered.editorSessionId
    if (disposed || signal.aborted || props.projectId !== projectId) { await close(); return }
    const id = sessionId!
    void poll(id, signal)
    const result = await api(`/${id}/agent`, { method: 'POST', body: JSON.stringify({ prompt: prompt.value }), signal })
    answer.value = result.output
  } catch (cause) {
    if (!error.value) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { await close(); running.value = false }
}
async function cancel() { error.value = '已停止任务。已执行的修改会保留，请检查场景；需要时使用撤销。'; await close() }
watch(() => props.projectId, () => { void close() })
onBeforeUnmount(() => { disposed = true; void close() })
</script>
<template>
  <section class="agent-panel" aria-label="AI 游戏助手">
    <p v-if="!projectId">请先通过“云端”登录并关联项目，再使用 AI 助手。</p>
    <form @submit.prevent="send">
      <label for="agent-prompt">描述你想修改的场景</label>
      <textarea id="agent-prompt" v-model="prompt" maxlength="8000" rows="2" :disabled="running" placeholder="例如：读取场景，创建一个名为 Player 的对象，然后验证它已创建。" />
      <button class="button button-primary" :disabled="running || !projectId || !prompt.trim()">{{ running ? 'AI 正在执行…' : '执行' }}</button>
      <button v-if="running" type="button" class="button" @click="cancel">停止</button>
    </form>
    <p class="hint">每次请求独立执行，修改后请保存项目。当前支持场景和组件编辑；暂不支持脚本生成与发布。</p>
    <div class="agent-output" aria-live="polite"><p v-for="(event, index) in events" :key="index">{{ event }}</p><p v-if="answer" class="answer">{{ answer }}</p></div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.agent-panel{padding:12px 16px;background:#29332e;border-bottom:1px solid #536157;max-height:40vh;overflow:auto}.agent-panel form{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.agent-panel textarea{flex:1;min-width:220px;padding:8px;color:#18251e;background:#f5f6f2;border-radius:6px}.agent-panel p{margin:5px 0;font-size:13px}.hint{color:#bcc7c2}.agent-output{max-height:130px;overflow:auto}.answer{white-space:pre-wrap}
</style>
