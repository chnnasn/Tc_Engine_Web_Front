<script setup lang="ts">
import AppLink from './AppLink.vue'
withDefaults(defineProps<{ id?: string; name: string; avatarUrl?: string | null; isAdmin?: boolean; showAvatar?: boolean; avatarOnly?: boolean }>(), { showAvatar: true, avatarOnly: false })
</script>
<template>
  <component :is="id ? AppLink : 'span'" class="user-identity" :href="id ? `/users/${encodeURIComponent(id)}` : undefined" :aria-label="avatarOnly ? `${name}的个人主页` : undefined">
    <span v-if="showAvatar" class="identity-avatar"><img v-if="avatarUrl" :src="avatarUrl" alt="" loading="lazy" /><span v-else>{{ name.slice(0, 1).toUpperCase() }}</span></span>
    <template v-if="!avatarOnly"><span class="identity-name">{{ name }}</span><span class="identity-role" :class="{ administrator: isAdmin }">{{ isAdmin ? '管理员' : '普通用户' }}</span></template>
  </component>
</template>
<style scoped>
.user-identity{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%;vertical-align:middle;color:inherit}.identity-avatar{width:32px;height:32px;flex-shrink:0;display:grid;place-items:center;border-radius:50%;background:#e4eadd;color:#42593c;overflow:hidden;font-size:13px}.identity-avatar img{width:100%;height:100%;object-fit:cover}.identity-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}.identity-role{font-size:10px!important;line-height:1.5;font-weight:400;padding:2px 6px;border-radius:4px;background:#eeeae3;color:#746c60;white-space:nowrap}.identity-role.administrator{background:#e1eadb;color:#3e6137}a.user-identity:hover .identity-name{color:#a65036;text-decoration:underline}
</style>
