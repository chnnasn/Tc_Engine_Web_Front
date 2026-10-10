<script setup lang="ts">
import { ref } from 'vue'
import ChangeSummary from './ChangeSummary.vue'
const props = defineProps<{ projectId: string; runId: string }>()
const events = ref<any[]>([]), error = ref(''), busy = ref(false), more = ref(false)
let cursor = 0
async function load(reset = true) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`/v1/projects/${encodeURIComponent(props.projectId)}/ai-runs/${encodeURIComponent(props.runId)}/events?after=${reset ? 0 : cursor}`, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('无法读取执行证据')
    const data = await response.json()
    events.value = reset ? data.events : [...events.value, ...data.events]; cursor = data.nextAfter; more.value = data.hasMore
  } catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
</script>
<template>
  <details class="task-evidence" @toggle="($event.target as HTMLDetailsElement).open && load()">
    <summary>执行证据与变更</summary>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="busy">正在读取…</p>
    <p v-if="!busy && !events.length">此任务没有已记录的工具调用。</p>
    <article v-for="event in events" :key="event.id">
      <strong>{{ event.tool }} · {{ event.state }}</strong>
      <ChangeSummary v-if="event.result?.data?.diff" :diff="event.result.data.diff" />
      <ChangeSummary v-else-if="event.tool === 'scene_get_diff' && event.result?.data?.changes" :diff="event.result.data" />
      <p v-if="event.tool === 'runtime_validate' && event.result?.ok">位置验收：{{ event.result.data.passed ? '通过' : '未通过' }} · {{ event.result.data.steps }} 步</p>
      <details><summary>参数与结果</summary><pre>{{ JSON.stringify({ arguments: event.arguments, result: event.result }, null, 2) }}</pre></details>
    </article>
    <button v-if="more" :disabled="busy" @click="load(false)">更多记录</button>
  </details>
</template>
<style scoped>
.task-evidence{font-size:12px;margin:10px 0}.task-evidence summary{cursor:pointer}.task-evidence article{padding:10px 0;border-bottom:1px solid var(--editor-border)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;font-size:11px}
</style>
