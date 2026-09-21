import { ref, watch, toValue, type Ref, type MaybeRefOrGetter } from 'vue'

export function useLocalState<T>(key: MaybeRefOrGetter<string>, initial: T, validate: (value: unknown) => value is T) {
  function read() {
    let value = initial
    try {
      const saved = localStorage.getItem(toValue(key))
      const parsed: unknown = saved ? JSON.parse(saved) : null
      if (validate(parsed)) value = parsed
    } catch {
      // Fall back to the provided value when storage is unavailable or corrupt.
    }

    return structuredClone(value)
  }
  const state = ref(read()) as Ref<T>
  const storageError = ref(false)
  let switching = false
  watch(() => toValue(key), () => {
    switching = true
    state.value = read()
    storageError.value = false
    switching = false
  }, { flush: 'sync' })
  watch(state, next => {
    if (switching) return
    try {
      localStorage.setItem(toValue(key), JSON.stringify(next))
      storageError.value = false
    } catch {
      storageError.value = true
    }
  }, { deep: true, flush: 'sync' })

  return { state, storageError }
}
