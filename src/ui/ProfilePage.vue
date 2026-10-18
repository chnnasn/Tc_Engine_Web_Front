<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, ArrowUpRight, Camera, Save } from '@lucide/vue'
import { games, type Topic } from './data'
import { useAccess } from './access'
import { userProfile, userTopics, updateDisplayName, uploadAvatar, type UserProfile } from './profile-api'
import { communityTime } from './community-api'
import UserIdentity from './UserIdentity.vue'
import AppLink from './AppLink.vue'
import EmptyState from './EmptyState.vue'
import GameCard from './GameCard.vue'
import TextLink from './TextLink.vue'

const props = withDefaults(defineProps<{ saved?: string[]; profileId?: string }>(), { saved: () => [] })
const emit = defineEmits<{ toggleSave: [id: string]; notify: [message: string] }>()
const { user } = useAccess()
const id = computed(() => props.profileId || user.value?.id)
const own = computed(() => Boolean(id.value && id.value === user.value?.id))
const profile = ref<UserProfile>()
const topics = ref<Topic[]>([])
const total = ref(0)
const offset = ref(0)
const displayName = ref('')
const error = ref('')
const editError = ref('')
const loading = ref(false)
const saving = ref(false)
const favorites = computed(() => games.filter(game => props.saved.includes(game.id)))
let request = 0
async function load() {
  const current = ++request
  if (!id.value) return
  loading.value = true; error.value = ''; profile.value = undefined
  try {
    const [info, page] = await Promise.all([userProfile(id.value), userTopics(id.value, offset.value)])
    if (current === request) { profile.value = info; displayName.value = info.displayName; topics.value = page.items; total.value = page.total }
  } catch (cause) { if (current === request) error.value = cause instanceof Error ? cause.message : '个人主页加载失败' }
  finally { if (current === request) loading.value = false }
}
async function edit(action: () => Promise<unknown>, message: string) {
  if (saving.value) return
  saving.value = true; editError.value = ''
  try { await action(); window.dispatchEvent(new Event('tomcat-auth-changed')); await load(); emit('notify', message) }
  catch (cause) { editError.value = cause instanceof Error ? cause.message : '保存失败，请重试' }
  finally { saving.value = false }
}
async function avatar(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]
  if (file) await edit(() => uploadAvatar(file), '头像已更新')
  input.value = ''
}
watch(id, () => { offset.value = 0; void load() }, { immediate: true })
watch(offset, load)
onBeforeUnmount(() => request++)
</script>
<template>
  <main id="main-content" class="page profile-page">
    <p v-if="loading" role="status">正在加载个人主页…</p>
    <p v-if="error" class="danger-text" role="alert">{{ error }} <button class="button" @click="load">重试</button></p>
    <template v-if="profile">
      <section class="person-summary">
        <div class="person-avatar"><img v-if="profile.avatarUrl" :src="profile.avatarUrl" :alt="`${profile.displayName}的头像`" /><span v-else>{{ profile.displayName.slice(0, 1) }}</span></div>
        <div class="person-heading"><span class="eyebrow">CREATOR PROFILE</span><h1>{{ profile.displayName }}</h1><UserIdentity :name="profile.isAdmin ? '社区管理团队' : '社区创作者'" :is-admin="profile.isAdmin" :show-avatar="false" /><p>加入于 {{ communityTime(profile.createdAt) }} · {{ profile.topics }} 个话题 · {{ profile.publishedGames }} 个公开作品</p></div>
        <AppLink v-if="own" href="/projects" class="button">我的项目<ArrowUpRight :size="16" /></AppLink>
      </section>
      <section v-if="own" class="person-edit" aria-label="编辑个人资料"><div><h2>编辑个人资料</h2><p>昵称和头像会显示在你的个人主页、话题与回复中。</p></div><form @submit.prevent="edit(() => updateDisplayName(displayName.trim()), '昵称已更新')"><label class="field-label" for="display-name">昵称</label><div class="person-name-form"><input id="display-name" v-model="displayName" class="text-input" required maxlength="32" :disabled="saving" /><button class="button button-primary" :disabled="saving || !displayName.trim() || displayName.trim() === profile.displayName"><Save :size="15" />保存昵称</button></div></form><div class="person-avatar-upload"><label class="button" :class="{ disabled: saving }"><Camera :size="16" />更换头像<input aria-label="上传头像" type="file" accept="image/png,image/jpeg,image/webp" :disabled="saving" @change="avatar" /></label><span>PNG / JPEG / WebP，最大 8 MB，自动裁剪为正方形</span></div><p v-if="editError" class="danger-text" role="alert">{{ editError }}</p></section>
      <section class="person-topics"><div class="section-heading"><h2>{{ own ? '我的话题' : '发布的话题' }}<span class="subtle-count">{{ total }}</span></h2><TextLink href="/community">前往社区</TextLink></div><AppLink v-for="topic in topics" :key="topic.id" class="person-topic" :href="`/community/${topic.id}`"><div><span class="topic-category">{{ topic.category }}</span><h3>{{ topic.title }}</h3><small>{{ communityTime(topic.time) }} · {{ topic.replies }} 条回复</small></div><ArrowRight :size="17" /></AppLink><p v-if="!topics.length" class="muted-small">还没有发布话题。</p><div v-if="total > 50" class="dialog-actions"><button class="button" :disabled="loading || !offset" @click="offset -= 50">上一页</button><button class="button" :disabled="loading || offset + 50 >= total" @click="offset += 50">下一页</button></div></section>
      <section v-if="own"><div class="section-heading favorites-heading"><h2>我的收藏<span class="subtle-count">{{ favorites.length }}</span></h2><TextLink href="/">继续发现</TextLink></div><div v-if="favorites.length" class="game-grid"><GameCard v-for="game in favorites" :key="game.id" :game="game" saved @toggle-save="emit('toggleSave', game.id)" /></div><EmptyState v-else title="把喜欢的世界收藏起来" text="点击作品旁的收藏图标，它就会出现在这里。"><AppLink href="/" class="button button-primary">去发现游戏<ArrowRight :size="16" /></AppLink></EmptyState></section>
    </template>
  </main>
</template>
<style scoped>
.person-summary{display:flex;align-items:center;gap:24px;background:#f0f1e9;border:1px solid #dedfd4;border-radius:16px;padding:32px;margin-bottom:28px}.person-avatar{width:90px;height:90px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;background:#dfe7d5;color:#526b43;font-size:36px;overflow:hidden}.person-avatar img{width:100%;height:100%;object-fit:cover}.person-heading{min-width:0;flex:1}.person-heading h1{font-size:29px;margin:8px 0 10px;overflow-wrap:anywhere}.person-heading p{font-size:12px;color:#777163;margin:12px 0 0}.person-edit{padding:24px;border:1px solid #e2ddd3;background:#fcfbf8;border-radius:14px;margin-bottom:36px;display:grid;gap:18px}.person-edit h2{font-size:17px;margin:0}.person-edit p{font-size:12px;color:#7a7265}.person-name-form{display:flex;gap:10px;max-width:560px}.person-name-form input{min-width:0}.person-name-form button{flex-shrink:0}.person-avatar-upload{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.person-avatar-upload input{position:absolute;opacity:0;width:1px;height:1px}.person-avatar-upload>span{font-size:12px;color:#81786b}.person-avatar-upload label:focus-within{outline:2px solid #a65036;outline-offset:3px}.person-topics{margin:30px 0 44px}.person-topic{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid #e3ded4;gap:16px}.person-topic h3{font-size:15px;margin:9px 0;overflow-wrap:anywhere}.person-topic small{font-size:12px;color:#81786b}@media(max-width:600px){.person-summary{padding:22px;gap:15px;flex-wrap:wrap}.person-avatar{width:64px;height:64px;font-size:28px}.person-heading{flex-basis:calc(100% - 80px)}.person-heading h1{font-size:24px}.person-edit{padding:18px}.person-name-form{flex-wrap:wrap}.person-name-form input{width:100%}}
</style>
