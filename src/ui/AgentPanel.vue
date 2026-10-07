<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowUp, Check, ChevronDown, MessageSquare, PanelRightClose, Square } from '@lucide/vue'
import { executeTool, type AutomationCommand, type EngineCall } from '../engine/automation'
import { engineCommit } from '../engine/storage'
import type { Snapshot } from '../engine/protocol'
import type { CheckpointReceipt } from '../engine/sync-status'

const props = defineProps<{ projectId?: string; visible?: boolean; call: EngineCall; checkpoint: (runId: string, phase: 'start' | 'end', signal: AbortSignal) => Promise<CheckpointReceipt> }>()
const emit = defineEmits<{ state: [snapshot: Snapshot]; collapse: [] }>()
const prompt = ref('')
const submittedPrompt = ref('')
const promptInput = ref<HTMLTextAreaElement>()
const outputArea = ref<HTMLElement>()
const detailsOpen = ref(false)
const suggestions = [
  { title: '看看当前场景', prompt: '读取当前场景，介绍已有对象和它们的组件。先不要修改。' },
  { title: '添加一个角色对象', prompt: '创建一个名为 Player 的对象，然后读取场景验证它已创建。' },
  { title: '检查选中的对象', prompt: '读取当前选中的对象及其组件，告诉我可以修改哪些属性。先不要修改。' },
]
function useSuggestion(value: string) { prompt.value = value; void nextTick(() => promptInput.value?.focus()) }
function promptKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send() }
}
watch(() => props.visible, value => { if (value) void nextTick(() => promptInput.value?.focus()) })
const answer = ref('')
const error = ref('')
const running = ref(false)
const events = ref<string[]>([])
const checkpoints = ref<CheckpointReceipt[]>([])
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
async function waitForRun(id: string, runId: string, signal: AbortSignal) {
  const deadline = Date.now() + 210000
  while (!signal.aborted && sessionId === id) {
    signal.throwIfAborted()
    const result = await api(`/${id}/agent-runs/${runId}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    if (result.state === 'succeeded') return result
    if (result.state === 'failed') throw new Error(result.error || 'AI 执行失败，请检查当前场景')
    if (result.state !== 'running') throw new Error('无法确认 AI 任务状态，请检查当前场景')
    if (Date.now() > deadline) throw new Error('等待 AI 结果超时，请检查当前场景')
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, 1000)
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) stop()
    })
  }
  throw new Error('编辑器会话已关闭')
}
async function send() {
  if (running.value || !prompt.value.trim() || !props.projectId) return
  submittedPrompt.value = prompt.value.trim()
  prompt.value = ''
  detailsOpen.value = false
  running.value = true; error.value = ''; answer.value = ''; events.value = []; checkpoints.value = []
  let stage = 'start'
  try {
    // Each request is an isolated run; no shared conversation or credentials across editors.
    await close()
    const projectId = props.projectId
    controller = new AbortController()
    const signal = controller.signal
    const runId = crypto.randomUUID().replace(/-/g, '')
    events.value.push('正在保存任务开始检查点…')
    const start = await props.checkpoint(runId, 'start', signal)
    checkpoints.value.push(start)
    signal.throwIfAborted()
    if (!start.current) throw new Error('开始检查点已保存，但场景同时发生变化；任务未执行，请检查后重试')
    stage = 'agent'
    const registered = await api('/', { method: 'POST', body: JSON.stringify({ projectId, engineCommit }), signal })
    sessionId = registered.editorSessionId
    if (disposed || signal.aborted || props.projectId !== projectId) { await close(); return }
    const id = sessionId!
    void poll(id, signal)
    await api(`/${id}/agent-runs`, { method: 'POST', body: JSON.stringify({ runId, prompt: submittedPrompt.value }), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    events.value.push('任务已提交，正在等待 AI 执行…')
    const result = await waitForRun(id, runId, signal)
    answer.value = result.output
    signal.throwIfAborted()
    stage = 'end'
    events.value.push('正在保存任务结束检查点…')
    const end = await props.checkpoint(runId, 'end', signal)
    checkpoints.value.push(end)
    if (!end.current) error.value = '结束检查点已落库，但场景有后续修改，尚未全部保存。'
  } catch (cause) {
    if (!disposed && !prompt.value) prompt.value = submittedPrompt.value
    if (!error.value) error.value = (stage === 'start' ? '任务未启动：' : stage === 'end' ? 'AI 已执行，但结束检查点未确认保存：' : '') + (cause instanceof Error ? cause.message : String(cause))
  } finally { await close(); running.value = false }
}
async function cancel() { error.value = '已停止任务。已执行的修改会保留，请检查场景；需要时使用撤销。'; await close() }
watch(() => props.projectId, () => { void close(); submittedPrompt.value = ''; prompt.value = ''; answer.value = ''; events.value = []; checkpoints.value = []; error.value = '' })
watch([answer, error, () => events.value.length], async () => {
  const element = outputArea.value
  const nearBottom = element && element.scrollHeight - element.scrollTop - element.clientHeight < 100
  await nextTick()
  if (element && nearBottom) element.scrollTop = element.scrollHeight
})
onBeforeUnmount(() => { disposed = true; void close() })
</script>
<template>
  <section id="editor-agent-panel" class="agent-panel" aria-label="AI 游戏助手">
    <header class="agent-heading"><div><MessageSquare :size="17" /><strong>AI 助手</strong><span>当前场景</span></div><button type="button" class="agent-icon" aria-label="收起 AI 助手" title="收起面板，任务继续执行" @click="emit('collapse')"><PanelRightClose :size="18" /></button></header>
    <div ref="outputArea" class="agent-conversation">
      <div v-if="!submittedPrompt" class="agent-welcome"><span class="agent-emblem" aria-hidden="true">✳</span><h2>一起把想法<br />做出来。</h2><p>从一个小改动开始。<br />描述你的想法，修改会直接出现在场景中。</p><div class="agent-suggestions"><button v-for="item in suggestions" :key="item.title" :disabled="!projectId" @click="useSuggestion(item.prompt)">{{ item.title }} <ArrowUp :size="14" /></button></div></div>
      <template v-else>
        <p class="agent-user-message">{{ submittedPrompt }}</p>
        <div class="agent-response">
          <div class="agent-response-label"><span aria-hidden="true">✳</span> TC Fun <span v-if="running" class="agent-working" /></div>
          <div v-if="events.length" class="agent-progress"><button :aria-expanded="detailsOpen" aria-controls="agent-event-list" @click="detailsOpen = !detailsOpen"><span>{{ running ? events[events.length - 1] : error ? '查看执行记录' : '执行完成' }}</span><ChevronDown :size="14" /></button><ol v-show="detailsOpen" id="agent-event-list"><li v-for="(event, index) in events" :key="index">{{ event }}</li></ol></div>
          <p class="sr-only" role="status">{{ running ? 'AI 正在执行任务' : answer ? 'AI 已完成任务' : '' }}</p>
          <div class="agent-output" aria-live="polite"><p v-if="answer" class="answer">{{ answer }}</p></div>
          <div v-if="checkpoints.length" class="agent-checkpoints"><p v-for="item in checkpoints" :key="item.phase" :title="item.revisionId"><Check :size="13" />{{ item.phase === 'start' ? '开始' : '结束' }}检查点：已落库</p></div>
          <p v-if="error" class="agent-error" role="alert">{{ error }}</p>
        </div>
      </template>
    </div>
    <div class="agent-compose-area">
      <p v-if="!projectId" class="agent-connection">正在关联云端项目，完成后即可使用 AI 助手。</p>
      <form class="agent-composer" @submit.prevent="send">
        <label class="sr-only" for="agent-prompt">描述你想修改的场景</label>
        <textarea id="agent-prompt" ref="promptInput" v-model="prompt" maxlength="8000" rows="3" :disabled="running || !projectId" placeholder="想对这个场景做些什么？" @keydown="promptKeydown" />
        <div class="agent-compose-footer"><span>{{ running ? '可收起面板，继续查看场景' : 'Ctrl / ⌘ + Enter 执行' }}</span><button v-if="running" type="button" class="agent-submit" aria-label="停止" title="停止任务，保留已执行的修改" @click="cancel"><Square :size="14" fill="currentColor" /></button><button v-else class="agent-submit" :disabled="!projectId || !prompt.trim()" aria-label="执行" title="执行"><ArrowUp :size="19" /></button></div>
      </form>
      <p class="agent-disclaimer">每次任务以当前场景为准。修改前后自动保存检查点；停止后保留已执行的修改。</p>
    </div>
  </section>
</template>
<style scoped>
.agent-panel{width:370px;min-width:320px;max-width:44vw;display:flex;flex-direction:column;min-height:0;background:#f7f5ef;color:#39342d;border-left:1px solid #d8d2c8}.agent-heading{display:flex;align-items:center;justify-content:space-between;padding:13px 17px;border-bottom:1px solid #e4dfd6;gap:8px}.agent-heading>div{display:flex;align-items:center;gap:8px}.agent-heading strong{font-size:13px;font-weight:550}.agent-heading span{font-size:10px;color:#82796d;border-left:1px solid #dcd5ca;padding-left:9px}.agent-icon{border:0;display:grid;place-items:center;background:transparent;color:#82796d;padding:7px;border-radius:6px}.agent-icon:hover{background:#eae5db}.agent-conversation{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:23px 20px}.agent-welcome{padding:20px 0}.agent-emblem{font-size:44px;color:#b46c50;line-height:1}.agent-welcome h2{font-family:Georgia,'Songti SC','SimSun',serif;font-size:29px;font-weight:500;line-height:1.5;margin:17px 0 12px}.agent-welcome>p{font-size:12px;line-height:1.9;color:#857a6e}.agent-suggestions{display:flex;flex-direction:column;gap:9px;margin-top:27px}.agent-suggestions button{display:flex;align-items:center;justify-content:space-between;text-align:left;font-size:12px;padding:12px 13px;border:1px solid #dfd9cf;background:transparent;border-radius:9px;color:#685e52}.agent-suggestions button:hover{background:#efeae1;border-color:#c8baaa}.agent-suggestions svg{transform:rotate(45deg);color:#a89988}.agent-user-message{background:#eae5db;border-radius:12px;padding:13px 16px;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin-bottom:24px}.agent-response-label{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;margin-bottom:15px}.agent-response-label>span:first-child{color:#b46c50;font-size:23px}.agent-working{width:6px;height:6px;border-radius:50%;background:#b46c50;animation:working 1.5s ease-in-out infinite}.agent-progress{margin:8px 0 17px;border:1px solid #e2dcd1;border-radius:8px;overflow:hidden}.agent-progress>button{display:flex;align-items:center;justify-content:space-between;width:100%;border:0;background:transparent;padding:10px 12px;gap:10px;font-size:11px;color:#827467;text-align:left}.agent-progress>button span{overflow-wrap:anywhere;min-width:0}.agent-progress>button[aria-expanded=true] svg{transform:rotate(180deg)}.agent-progress ol{padding:0 15px 12px 30px;margin:0;max-height:200px;overflow:auto;font:11px/1.9 ui-monospace,monospace;color:#827467;overflow-wrap:anywhere}.answer{white-space:pre-wrap;font-size:13px;line-height:1.9;overflow-wrap:anywhere}.agent-checkpoints{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.agent-checkpoints p{display:flex;align-items:center;gap:4px;font-size:10px;color:#6e795f;background:#e9ede3;border-radius:5px;padding:4px 7px}.agent-error{margin-top:13px;color:#9d4131;font-size:12px;line-height:1.8;padding:12px;background:#f2e5de;border-radius:8px;overflow-wrap:anywhere}.agent-compose-area{padding:14px 15px 12px;border-top:1px solid #e4dfd6}.agent-composer{background:#fffdf9;border:1px solid #d9d1c5;border-radius:13px;padding:12px;box-shadow:0 2px 6px #30292206}.agent-composer:focus-within{border-color:#b5a48e;box-shadow:0 0 0 2px #cbbba220}.agent-composer textarea{display:block;width:100%;resize:vertical;min-height:72px;max-height:160px;padding:0;background:transparent;border:0;outline:none;color:#39342d;font-size:13px;line-height:1.8}.agent-composer textarea:focus-visible{outline:none}.agent-composer textarea::placeholder{color:#a39787}.agent-compose-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.agent-compose-footer>span{font-size:10px;color:#918577}.agent-submit{display:grid;place-items:center;width:33px;height:33px;border:0;border-radius:9px;color:#fffaf3;background:#a65036}.agent-submit:hover{background:#88412d}.agent-disclaimer{font-size:10px;color:#918577;line-height:1.7;margin:9px 3px 0}.agent-connection{font-size:12px;color:#9d4131;margin-bottom:12px}.agent-output{margin:0}@keyframes working{50%{opacity:.3}}@media(max-width:760px){.agent-panel{width:100%;max-width:100%;min-width:0;height:min(62dvh,600px);flex:0 0 min(62dvh,600px);border-left:0;border-top:1px solid #d8d2c8}.agent-welcome{padding:0}.agent-welcome h2{font-size:24px}.agent-welcome h2 br{display:none}.agent-welcome>p br{display:none}.agent-emblem{display:none}.agent-suggestions{margin-top:14px}.agent-conversation{padding:15px}.agent-compose-area{padding:10px 15px}.agent-composer textarea{min-height:54px}.agent-welcome h2{margin-top:0}}@media(prefers-reduced-motion:reduce){.agent-working{animation:none}}
</style>
