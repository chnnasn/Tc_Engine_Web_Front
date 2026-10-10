<script setup lang="ts">
import type { sceneDiff } from '../engine/semantic-diff'
defineProps<{ diff: ReturnType<typeof sceneDiff> }>()
const display = (value: unknown) => {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'object' && 'components' in value && Array.isArray(value.components)) return `${'name' in value ? value.name : '实体'}（${value.components.length} 个组件）`
  if (typeof value === 'object' && 'values' in value) return '组件及其属性'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 250 ? text.slice(0, 250) + '…' : text
}
</script>
<template>
  <div class="semantic-diff">
    <p>{{ diff.total }} 项场景变化<span v-if="diff.truncated">（显示前 {{ diff.changes.length }} 项）</span></p>
    <p v-if="diff.archiveChanged && !diff.total">场景归档发生变化，可能涉及脚本挂载或未展开的属性。</p>
    <ul><li v-for="(change, index) in diff.changes" :key="index"><strong>{{ change.entity || '场景' }} · {{ change.component }} {{ change.property }}</strong><div><del>{{ display(change.before) }}</del> → <ins>{{ display(change.after) }}</ins></div></li></ul>
    <small>包含期间发生的人工编辑；场景差异不覆盖所有脚本和资源内容。</small>
  </div>
</template>
<style scoped>
.semantic-diff{font-size:12px;overflow-wrap:anywhere}.semantic-diff ul{list-style:none;padding:0}.semantic-diff li{padding:8px 0;border-bottom:1px solid var(--editor-border)}.semantic-diff strong{font-weight:500}.semantic-diff del{color:#dfa4a4}.semantic-diff ins{color:#a1cfa6;text-decoration:none}.semantic-diff small{color:var(--editor-muted)}
</style>
