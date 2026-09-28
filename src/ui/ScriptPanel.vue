<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Snapshot } from '../engine/protocol'
export interface ScriptEntry { path: string; handle: string; className: string; text: string }
export interface ScriptDiagnostic { severity: string; code: string; message: string; file: string | null; line: number; column: number }
interface ScriptsReply { scripts: ScriptEntry[]; installed: boolean; assemblyLoaded?: boolean; diagnostics: ScriptDiagnostic[] }
interface CompileReply { succeeded: boolean; restartRequired?: boolean; diagnostics: ScriptDiagnostic[]; scripts: number }
interface Attachment { handle: string; className: string; attachmentId?: string }

const props = defineProps<{ call: <T = any>(type: string, payload?: unknown) => Promise<T>; disabled?: boolean; entityId?: string | null; entityName?: string | null }>()
const emit = defineEmits<{ notify: [message: string]; dirty: []; restart: []; snapshot: [snapshot: Snapshot] }>()

const scripts = ref<ScriptEntry[]>([])
const selected = ref('')
const draft = ref('')
const installed = ref(false)
const loaded = ref(false)
const restartRequired = ref(false)
const diagnostics = ref<ScriptDiagnostic[]>([])
const attachments = ref<Attachment[]>([])
const busy = ref(false)
const message = ref('')
const newName = ref('')
const fileInput = ref<HTMLInputElement>()

const current = computed(() => scripts.value.find(script => script.path === selected.value))
const dirty = computed(() => Boolean(current.value) && draft.value !== current.value!.text)
const errors = computed(() => diagnostics.value.filter(diagnostic => diagnostic.severity === 'error'))
const state = computed(() => installed.value ? '已编译安装' : loaded.value ? '已安装，脚本已修改' : '未编译')
const stateClass = computed(() => installed.value ? 'ok' : loaded.value ? 'stale' : '')
// 本会话已装载过程序集，但磁盘脚本与它不一致 → 只有重建会话才能让改动生效。
const rebuildNeeded = computed(() => restartRequired.value || (loaded.value && !installed.value))
const attachedNames = computed(() => attachments.value.map(item => item.className))
const selectedAttached = computed(() => Boolean(current.value) && attachedNames.value.includes(current.value!.className))

function adopt(reply: ScriptsReply) {
  scripts.value = reply.scripts ?? []
  installed.value = Boolean(reply.installed)
  loaded.value = Boolean(reply.assemblyLoaded)
  if (reply.diagnostics?.length) diagnostics.value = reply.diagnostics
  if (!scripts.value.some(script => script.path === selected.value)) selected.value = scripts.value[0]?.path ?? ''
  draft.value = current.value?.text ?? ''
}
async function refresh() {
  if (props.disabled) return
  try { adopt(await props.call<ScriptsReply>('scripts')); await refreshEntity() }
  catch (error) { message.value = error instanceof Error ? error.message : String(error) }
}
async function refreshEntity() {
  if (!props.entityId) { attachments.value = []; return }
  try {
    const reply = await props.call<{ attachments: Attachment[] }>('scriptEntity', { entityId: props.entityId })
    attachments.value = reply.attachments ?? []
  } catch { attachments.value = [] }
}
async function run(action: () => Promise<void>) {
  if (busy.value || props.disabled) return
  busy.value = true; message.value = ''; restartRequired.value = false
  try { await action() }
  catch (error) { message.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
function select(path: string) {
  if (dirty.value) emit('notify', '请先保存当前脚本的修改')
  selected.value = path
  draft.value = scripts.value.find(script => script.path === path)?.text ?? ''
}
const template = (name: string) => `using TomCat;

public sealed class ${name} : TomCatBehaviour
{
    protected override void OnCreate()
    {
    }

    protected override void OnUpdate(float deltaTime)
    {
    }
}
`
function create() {
  void run(async () => {
    const name = newName.value.trim().replace(/[^A-Za-z0-9_]/g, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('请输入合法的 C# 类名（字母、数字、下划线）')
    const reply = await props.call<ScriptsReply>('scriptWrite', { path: `Assets/Scripts/${name}.cs`, text: template(name) })
    adopt(reply)
    selected.value = `Assets/Scripts/${name}.cs`
    draft.value = template(name)
    newName.value = ''
    emit('dirty'); emit('notify', `已新建脚本 ${name}.cs，保存项目后即可随云端同步`)
  })
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  await run(async () => {
    if (!/\.cs$/i.test(file.name)) throw new Error('请选择 .cs 文件')
    if (file.size > 512 * 1024) throw new Error('单个脚本不能超过 512 KiB')
    const reply = await props.call<ScriptsReply>('scriptWrite', { path: `Assets/Scripts/${file.name}`, text: await file.text() })
    adopt(reply)
    selected.value = `Assets/Scripts/${file.name}`
    draft.value = scripts.value.find(script => script.path === selected.value)?.text ?? ''
    emit('dirty'); emit('notify', `已导入 ${file.name}`)
  })
}
function save() {
  void run(async () => {
    if (!current.value) return
    adopt(await props.call<ScriptsReply>('scriptWrite', { path: current.value.path, text: draft.value, handle: current.value.handle || undefined }))
    emit('dirty'); emit('notify', '脚本已写入项目文件，请编译并保存项目')
  })
}
function remove() {
  void run(async () => {
    if (!current.value) return
    const reply = await props.call<ScriptsReply>('scriptDelete', { path: current.value.path })
    adopt(reply); emit('dirty'); emit('notify', `已删除 ${current.value.className}`)
  })
}
function compile() {
  void run(async () => {
    if (dirty.value) {
      adopt(await props.call<ScriptsReply>('scriptWrite', { path: current.value!.path, text: draft.value, handle: current.value!.handle || undefined }))
    }
    const reply = await props.call<CompileReply>('scriptCompile')
    diagnostics.value = reply.diagnostics ?? []
    installed.value = reply.succeeded
    loaded.value = loaded.value || reply.succeeded || Boolean(reply.restartRequired)
    if (reply.succeeded) { emit('dirty'); emit('notify', `C# 编译成功，已安装 ${reply.scripts} 个脚本，可运行预览`) }
    else if (reply.restartRequired) restartRequired.value = true
    else message.value = `编译失败：${errors.value.length} 个错误`
  })
}
/** 交给宿主页面重建引擎会话：新模块启动时会带上当前项目，重新编译安装最新脚本。 */
function rebuild() {
  if (busy.value || props.disabled) return
  restartRequired.value = false
  emit('restart')
}
/** 把当前脚本挂载到层级中选中的实体（经场景归档注入 CSharpScripts）。 */
function attach() {
  void run(async () => {
    if (!props.entityId) throw new Error('请先在层级中选中一个实体')
    if (!current.value) throw new Error('请先选择一个脚本')
    const reply = await props.call<{ attachments: Attachment[]; snapshot: Snapshot }>('scriptAttach', { entityId: props.entityId, paths: [current.value.path] })
    attachments.value = reply.attachments
    emit('snapshot', reply.snapshot); emit('dirty')
    emit('notify', `已把 ${current.value.className} 挂载到 ${props.entityName || '选中实体'}`)
  })
}
function detach() {
  void run(async () => {
    if (!props.entityId) throw new Error('请先在层级中选中一个实体')
    const reply = await props.call<{ attachments: Attachment[]; snapshot: Snapshot }>('scriptDetach', { entityId: props.entityId })
    attachments.value = reply.attachments
    emit('snapshot', reply.snapshot); emit('dirty')
    emit('notify', '已移除该实体的 C# 脚本挂载')
  })
}
onMounted(refresh)
watch(() => props.entityId, refreshEntity)
defineExpose({ refresh })
</script>
<template>
  <section class="script-panel">
    <header>
      <strong>C# 脚本</strong>
      <span class="state" :class="stateClass">{{ state }}</span>
      <input v-model="newName" placeholder="新脚本类名" :disabled="busy" />
      <button class="button" :disabled="busy" @click="create">新建</button>
      <button class="button" :disabled="busy" @click="fileInput?.click()">导入 .cs</button>
      <button class="button" :disabled="busy || !scripts.length" @click="compile">编译并安装</button>
      <button class="button" :disabled="busy || !current" @click="save">保存脚本</button>
      <button class="button" :disabled="busy || !current" @click="remove">删除</button>
      <input ref="fileInput" hidden type="file" accept=".cs" @change="importFile" />
    </header>
    <div v-if="rebuildNeeded" class="rebuild" role="alert">
      <span>源码编译通过，但当前会话已加载过一代 C# 程序集。浏览器 WebAssembly 不支持热替换，需要重建引擎会话后重新编译安装。</span>
      <button class="button button-primary" :disabled="busy" @click="rebuild">重建引擎会话</button>
    </div>
    <div class="attach">
      <span class="target">挂载目标：<b>{{ entityName || '未选中实体' }}</b></span>
      <span v-if="attachedNames.length" class="chips">
        <em v-for="name in attachedNames" :key="name">{{ name }}</em>
      </span>
      <span v-else class="muted">该实体尚未挂载脚本</span>
      <button class="button" :disabled="busy || !current || !entityId" @click="attach">{{ selectedAttached ? '重新挂载当前脚本' : '挂载当前脚本' }}</button>
      <button class="button" :disabled="busy || !entityId || !attachedNames.length" @click="detach">移除挂载</button>
    </div>
    <div class="body">
      <ul class="list">
        <li v-for="script in scripts" :key="script.path" :class="{ active: script.path === selected }" @click="select(script.path)">
          <span class="class-name">{{ script.className }}</span>
          <span class="path">{{ script.path.replace('Assets/Scripts/', '') }}</span>
        </li>
        <li v-if="!scripts.length" class="empty">Assets/Scripts 下还没有脚本。新建或导入一个 .cs 文件即可在浏览器内编译。</li>
      </ul>
      <textarea v-model="draft" spellcheck="false" :disabled="!current" aria-label="C# 脚本源码" />
    </div>
    <p v-if="message" class="message" role="alert">{{ message }}</p>
    <ul v-if="diagnostics.length" class="diagnostics">
      <li v-for="(diagnostic, index) in diagnostics" :key="index" :class="diagnostic.severity">
        <b>{{ diagnostic.code }}</b>
        <span>{{ diagnostic.message }}</span>
        <em v-if="diagnostic.file">{{ diagnostic.file }}:{{ diagnostic.line }}:{{ diagnostic.column }}</em>
      </li>
    </ul>
    <p v-else-if="installed" class="ok-note" role="status">编译诊断为空。含 C# 的场景现在可以“运行预览”。</p>
  </section>
</template>
<style scoped>
.script-panel{display:flex;flex-direction:column;gap:8px;padding:10px 16px;background:#26292f;color:#e8eeee;border-bottom:1px solid #34383f}
.script-panel header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.script-panel header strong{margin-right:4px}
.script-panel header input{min-height:34px;padding:6px 10px;border-radius:8px;border:1px solid #454a53;background:#1b1e23;color:#e8eeee;width:180px}
.state{font-size:12px;padding:2px 9px;border-radius:999px;background:#3a3f47;color:#c3ccd4}
.state.ok{background:#1f4635;color:#8fe0b6}
.state.stale{background:#4a3a1f;color:#f0c887}
.rebuild{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:#4a3a1f;color:#f4dcb4;font-size:13px;line-height:1.6}
.rebuild span{flex:1}
.rebuild .button{background:#6d5320;color:#fff5e0;border:1px solid #8a6a2c}
.attach{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:#c3ccd4}
.attach .target b{color:#e8eeee}
.attach .chips{display:flex;gap:6px;flex-wrap:wrap}
.attach .chips em{font-style:normal;padding:2px 8px;border-radius:999px;background:#2f3947;color:#a9c6e8}
.attach .muted{color:#8d97a2}
.body{display:flex;gap:10px;min-height:220px}
.list{list-style:none;margin:0;padding:0;width:220px;max-height:320px;overflow:auto;background:#1b1e23;border:1px solid #34383f;border-radius:10px}
.list li{padding:8px 10px;cursor:pointer;border-bottom:1px solid #2b2f36;display:flex;flex-direction:column}
.list li:last-child{border-bottom:none}
.list li.active{background:#2f3947}
.list li.empty{cursor:default;color:#9aa5b1;font-size:12.5px;line-height:1.6}
.class-name{font-weight:600}
.path{font-size:11.5px;color:#9aa5b1}
textarea{flex:1;min-height:220px;resize:vertical;background:#1b1e23;color:#e8eeee;border:1px solid #34383f;border-radius:10px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6}
.message{margin:0;color:#ffb4b4}
.diagnostics{list-style:none;margin:0;padding:0;max-height:150px;overflow:auto;font-size:12.5px}
.diagnostics li{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #2b2f36;color:#d6dde4}
.diagnostics li.error b{color:#ff9d9d}
.diagnostics li.warning b{color:#ffd08a}
.diagnostics em{color:#9aa5b1;font-style:normal;margin-left:auto}
.ok-note{margin:0;color:#8fe0b6;font-size:12.5px}
</style>
