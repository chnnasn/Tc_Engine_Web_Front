<script setup lang="ts">
import { ref } from 'vue'
import { Trash2 } from '@lucide/vue'
import { useAccess } from './access'
import { siteApi } from './community-api'
import AppModal from './AppModal.vue'
const props = defineProps<{ kind: 'topics' | 'replies'; id: string }>()
const emit = defineEmits<{ deleted: [] }>()
const { user } = useAccess()
const open = ref(false), busy = ref(false), reason = ref(''), error = ref('')
async function remove() {
  if (busy.value || !reason.value.trim()) return
  busy.value = true; error.value = ''
  try {
    await siteApi(`/admin/${props.kind}/${encodeURIComponent(props.id)}`, 'DELETE', { reason: reason.value.trim() })
    open.value = false; emit('deleted')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败，请重试' }
  finally { busy.value = false }
}
</script>
<template>
  <template v-if="user?.isAdmin"><button class="inline-delete" @click="open = true; error = ''; reason = ''"><Trash2 :size="13" />{{ kind === 'replies' ? '删除回复' : '删除话题' }}</button><AppModal v-if="open" :title="kind === 'replies' ? '删除这条回复' : '删除这个话题'" @close="!busy && (open = false)"><p class="dialog-description">{{ kind === 'replies' ? '此回复将永久删除。' : '此话题及全部回复将永久删除。' }}操作会记录到管理日志中。</p><form @submit.prevent="remove"><label for="inline-delete-reason" class="field-label">删除原因</label><textarea id="inline-delete-reason" v-model="reason" class="text-input" rows="3" maxlength="500" required autofocus /><p v-if="error" class="danger-text" role="alert">{{ error }}</p><div class="dialog-actions"><button class="button" type="button" :disabled="busy" @click="open = false">取消</button><button class="button button-primary" :disabled="busy || !reason.trim()">{{ busy ? '正在删除…' : '确认删除' }}</button></div></form></AppModal></template>
</template>
<style scoped>
.inline-delete{display:inline-flex;align-items:center;gap:5px;padding:5px 0;border:0;background:none;color:#a65036;font-size:12px;cursor:pointer}.inline-delete:hover{text-decoration:underline}
</style>
