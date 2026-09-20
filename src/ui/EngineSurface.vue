<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { EngineError, type Snapshot, type SceneState } from '../engine/protocol'
import type { EngineDocument } from '../engine/storage'
const props = defineProps<{ kind: 'editor' | 'player'; name?: string; template?: string; document?: EngineDocument; bytes?: Uint8Array }>()
const emit = defineEmits<{ ready: [snapshot?: Snapshot]; state: [state: SceneState]; actions: [actions: number]; error: [message: string] }>()
const iframe = ref<HTMLIFrameElement>()
const active = ref(true)
const loading = ref(true)
const error = ref('')
const hostUrl = `${import.meta.env.BASE_URL}engine-host.html`
let port: MessagePort | undefined
let sequence = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let bootTimer: ReturnType<typeof setTimeout> | undefined
// Vue refs contain proxies, which the structured-clone algorithm cannot send.
function wire(value: any): any {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map(wire)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]))
  return value
}
function stop() {
  clearTimeout(bootTimer)
  // Synchronous cleanup before removing the same-origin browsing context.
  try { iframe.value?.contentWindow?.dispatchEvent(new Event('pagehide')) } catch { /* Context already gone. */ }
  port?.close(); port = undefined
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('引擎会话已关闭')) }
  pending.clear(); active.value = false
}
function fail(message: string) { error.value = message; loading.value = false; stop(); emit('error', message) }
function connect() {
  if (!active.value || port) return
  const channel = new MessageChannel(); port = channel.port1
  bootTimer = setTimeout(() => fail('引擎启动超时，请检查资源下载后重试'), 120000)
  port.onmessage = event => {
    const data = event.data
    if (data.event === 'ready') { clearTimeout(bootTimer); loading.value = false; emit('ready', data.snapshot) }
    else if (data.event === 'fatal') fail(data.message)
    else if (data.event === 'state') emit('state', data.state)
    else if (data.event === 'actions') emit('actions', data.actions)
    else if (pending.has(data.id)) {
      const item = pending.get(data.id)!; pending.delete(data.id); clearTimeout(item.timer)
      if (data.error) item.reject(new EngineError(data.error.code, data.error.message)); else item.resolve(data.result)
    }
  }
  iframe.value!.contentWindow!.postMessage(wire({ type: 'tomcat-connect', ...props }), location.origin, [channel.port2])
}
function call<T = any>(type: string, payload: unknown = {}): Promise<T> {
  if (!port || loading.value) return Promise.reject(new Error('引擎尚未就绪'))
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('引擎请求超时')) }, 15000)
    pending.set(id, { resolve, reject, timer })
    try { port!.postMessage(wire({ id, type, payload })) }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
  })
}
onBeforeUnmount(stop)
defineExpose({ call, stop })
</script>
<template>
  <div class="engine-surface">
    <iframe v-if="active" ref="iframe" :src="hostUrl" :title="kind === 'editor' ? 'TomCat 原生编辑器' : 'TomCat 游戏播放器'" allow="cross-origin-isolated; fullscreen" @load="connect" />
    <div v-if="loading || error" class="engine-message" role="status">{{ error || '正在加载 TomCat 引擎…' }}</div>
  </div>
</template>
<style scoped>
.engine-surface{position:relative;width:100%;height:100%;min-height:320px;background:#202329}.engine-surface iframe{width:100%;height:100%;border:0;display:block}.engine-message{position:absolute;inset:0;display:grid;place-content:center;padding:32px;text-align:center;color:#e9eeee;background:#202329}
</style>
