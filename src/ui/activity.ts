import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { CloudUser } from '../engine/cloud'

export function useActivity(user: Ref<CloudUser | undefined>) {
  const tabId = crypto.randomUUID().replace(/-/g, '')
  let timer: ReturnType<typeof setInterval> | undefined
  let active = false
  let queue = Promise.resolve()
  function send(stop: boolean) {
    if (!user.value && !active) return
    active = !stop
    queue = queue.then(async () => {
      try {
        await fetch(`/v1/activity/${stop ? 'stop' : 'heartbeat'}`, {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'X-TomCat-Request': '1' },
          body: JSON.stringify({ tabId }), signal: AbortSignal.timeout(15000),
        })
      } catch { /* A lost heartbeat expires on the server after 60 seconds. */ }
    })
  }
  function sync() {
    clearInterval(timer)
    if (user.value && document.visibilityState === 'visible') {
      send(false); timer = setInterval(() => send(false), 30000)
    } else if (active) send(true)
  }
  function stop() { clearInterval(timer); if (active) send(true) }
  watch(() => user.value?.id, sync, { immediate: true })
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('pagehide', stop)
  onBeforeUnmount(() => { stop(); document.removeEventListener('visibilitychange', sync); window.removeEventListener('pagehide', stop) })
}
