<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Code2, FileCode2, PanelRightClose, Plus, Trash2, Upload } from '@lucide/vue'
import type { Snapshot } from '../engine/protocol'
export interface ScriptEntry { path: string; handle: string; className: string; text: string }
export interface ScriptDiagnostic { severity: string; code: string; message: string; file: string | null; line: number; column: number }
interface ScriptsReply { scripts: ScriptEntry[]; installed: boolean; assemblyLoaded?: boolean; diagnostics: ScriptDiagnostic[] }
interface CompileReply { succeeded: boolean; restartRequired?: boolean; diagnostics: ScriptDiagnostic[]; scripts: number }
interface Attachment { handle: string; className: string; attachmentId?: string }

const props = defineProps<{ call: <T = any>(type: string, payload?: unknown) => Promise<T>; visible?: boolean; disabled?: boolean; entityId?: string | null; entityName?: string | null }>()
const emit = defineEmits<{ notify: [message: string]; dirty: []; draftChange: [dirty: boolean]; collapse: []; restart: []; snapshot: [snapshot: Snapshot] }>()

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
  if (props.disabled || busy.value || dirty.value) return
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
  if (path === selected.value) return
  if (dirty.value) { emit('notify', '请先保存当前脚本的修改'); return }
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
    if (dirty.value) throw new Error('请先保存当前脚本的修改')
    const name = newName.value.trim().replace(/[^A-Za-z0-9_]/g, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('请输入合法的 C# 类名（字母、数字、下划线）')
    if (scripts.value.some(script => script.path === `Assets/Scripts/${name}.cs`)) throw new Error('同名脚本已存在，请使用其他名称')
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
    if (dirty.value) throw new Error('请先保存当前脚本的修改')
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
    const name = current.value.className
    const reply = await props.call<ScriptsReply>('scriptDelete', { path: current.value.path })
    adopt(reply); emit('dirty'); emit('notify', `已删除 ${name}`)
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
  if (busy.value || props.disabled || dirty.value) return
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
watch(() => props.visible, visible => { if (visible) void refresh() })
watch(dirty, value => emit('draftChange', value))
function sourceKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); save() }
}
defineExpose({ refresh })
</script>
<template>
  <section id="editor-script-panel" class="script-panel" aria-label="C# 脚本面板">
    <header class="script-heading">
      <div><Code2 :size="17" /><strong>C# 脚本</strong><span>当前项目</span></div>
      <button class="script-icon" aria-label="收起 C# 脚本" title="收起面板，保留草稿" @click="emit('collapse')"><PanelRightClose :size="18" /></button>
    </header>
    <div class="script-content">
      <form class="script-create" @submit.prevent="create">
        <label class="sr-only" for="script-name">新脚本类名</label>
        <input id="script-name" v-model="newName" placeholder="新脚本类名" :disabled="busy || dirty" />
        <button class="script-icon" :disabled="busy || dirty || !newName.trim()" aria-label="新建" title="新建脚本"><Plus :size="17" /></button>
        <button type="button" class="script-icon" :disabled="busy || dirty" aria-label="导入 .cs" title="导入 .cs" @click="fileInput?.click()"><Upload :size="16" /></button>
        <input ref="fileInput" hidden type="file" accept=".cs" @change="importFile" />
      </form>
      <ul v-if="scripts.length" class="list" aria-label="项目脚本">
        <li v-for="script in scripts" :key="script.path">
          <button :class="{ active: script.path === selected }" :aria-pressed="script.path === selected" :disabled="busy" :title="script.path" @click="select(script.path)"><FileCode2 :size="14" /><span>{{ script.path.replace('Assets/Scripts/', '') }}</span><span v-if="script.path === selected && dirty" class="draft-dot" aria-label="未保存" /></button>
        </li>
      </ul>
      <div v-if="current" class="source-area">
        <div class="source-heading"><span>{{ current.className }}<small>{{ dirty ? '未保存' : '已写入项目' }}</small></span><button class="script-icon" :disabled="busy" aria-label="删除" title="删除当前脚本" @click="remove"><Trash2 :size="14" /></button></div>
        <textarea v-model="draft" spellcheck="false" :disabled="busy" aria-label="C# 脚本源码" @keydown="sourceKeydown" />
        <div class="source-footer"><span>C#</span><span>Ctrl / ⌘ + S 保存脚本</span></div>
      </div>
      <div v-else class="script-empty"><Code2 :size="30" :stroke-width="1.3" /><h2>给场景添一点逻辑。</h2><p>输入类名新建脚本，<br />或导入已有的 .cs 文件。</p></div>
      <div class="attach">
        <div class="attach-heading"><span>挂载到</span><strong>{{ entityName || '请先在场景中选择对象' }}</strong></div>
        <div v-if="attachedNames.length" class="chips"><em v-for="name in attachedNames" :key="name">{{ name }}</em></div>
        <div class="attach-actions"><button class="button" :disabled="busy || !current || !entityId" @click="attach">{{ selectedAttached ? '重新挂载当前脚本' : '挂载当前脚本' }}</button><button class="script-text-button" :disabled="busy || !entityId || !attachedNames.length" @click="detach">移除挂载</button></div>
      </div>
      <div v-if="rebuildNeeded" class="rebuild" role="alert"><p>脚本已修改，需要重建会话后重新编译，才能运行新代码。</p><button class="button" :disabled="busy || dirty" @click="rebuild">重建引擎会话</button><p v-if="dirty">请先保存脚本。</p></div>
      <p v-if="message" class="message" role="alert">{{ message }}</p>
      <ul v-if="diagnostics.length" class="diagnostics" aria-label="编译诊断"><li v-for="(diagnostic, index) in diagnostics" :key="index" :class="diagnostic.severity"><b>{{ diagnostic.code }}</b><span>{{ diagnostic.message }}</span><em v-if="diagnostic.file">{{ diagnostic.file }}:{{ diagnostic.line }}:{{ diagnostic.column }}</em></li></ul>
    </div>
    <footer class="script-actions">
      <div class="compile-status"><span class="state" :class="stateClass">{{ state }}</span><span v-if="installed && !dirty" class="ok-note" role="status">可在场景中运行预览</span></div>
      <div><button class="button" :disabled="busy || !current" @click="save">保存脚本</button><button class="button button-primary" :disabled="busy || !scripts.length" @click="compile">{{ busy ? '处理中…' : '编译并安装' }}</button></div>
    </footer>
  </section>
</template>
<style scoped>
.script-panel{width:460px;flex:0 0 460px;max-width:46vw;min-width:0;min-height:0;display:flex;flex-direction:column;background:#f7f5ef;color:#39342d;border-left:1px solid #d8d2c8}
.script-heading{display:flex;align-items:center;justify-content:space-between;padding:13px 17px;border-bottom:1px solid #e4dfd6;gap:8px;flex-shrink:0}.script-heading>div{display:flex;align-items:center;gap:8px}.script-heading strong{font-size:13px;font-weight:550}.script-heading span{font-size:10px;color:#82796d;border-left:1px solid #dcd5ca;padding-left:9px}
.script-icon{border:0;display:grid;place-items:center;flex-shrink:0;background:transparent;color:#82796d;padding:7px;border-radius:6px}.script-icon:hover:not(:disabled){background:#eae5db}
.script-content{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;gap:14px}.script-create{display:flex;align-items:center;gap:4px;flex-shrink:0;border:1px solid #d9d1c5;border-radius:9px;background:#fffdf9;padding:4px 6px}.script-create:focus-within{border-color:#b5a48e}.script-create input{min-width:0;width:100%;border:0;background:transparent;padding:6px;color:#39342d;font-size:12px;outline:none}
.list{display:flex;flex-wrap:wrap;gap:5px;list-style:none;margin:0;padding:0;max-height:108px;overflow:auto;flex-shrink:0}.list li{min-width:0;max-width:100%}.list button{display:flex;align-items:center;gap:6px;max-width:100%;border:1px solid transparent;background:transparent;border-radius:6px;padding:7px 9px;color:#857a6e;font-size:11px}.list button.active{background:#ebe4d9;border-color:#dcd0c0;color:#654b37}.list button>span:first-of-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.draft-dot{width:5px;height:5px;background:#a65036;border-radius:50%;flex-shrink:0}
.source-area{flex:1 0 280px;display:flex;flex-direction:column;min-height:280px;border:1px solid #dfd9cf;border-radius:10px;overflow:hidden;background:#fffdf9}.source-heading{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #eee8de;font-size:12px}.source-heading>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-heading small{font-size:10px;color:#998977;margin-left:9px}.source-area textarea{flex:1;min-height:200px;width:100%;resize:none;background:transparent;color:#443c33;border:0;padding:13px;font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:4;white-space:pre;overflow:auto}.source-area textarea:focus-visible{outline:2px solid #b5a48e;outline-offset:-2px}.source-footer{display:flex;justify-content:space-between;padding:7px 12px;border-top:1px solid #eee8de;font-size:10px;color:#998977}
.script-empty{flex:1;min-height:200px;padding:28px 8px;color:#857a6e}.script-empty>svg{color:#b46c50}.script-empty h2{font-family:Georgia,'Songti SC',serif;font-size:22px;font-weight:500;color:#39342d;margin:18px 0 10px}.script-empty p{font-size:12px;line-height:1.9}
.attach{border-top:1px solid #e4dfd6;padding-top:12px;display:flex;flex-direction:column;gap:9px;font-size:11px;flex-shrink:0}.attach-heading{display:flex;align-items:baseline;gap:9px;min-width:0}.attach-heading>span{color:#918577;flex-shrink:0}.attach-heading strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chips{display:flex;flex-wrap:wrap;gap:5px}.chips em{font-style:normal;padding:3px 7px;background:#e9ede3;color:#657157;border-radius:5px}.attach-actions{display:flex;align-items:center;gap:12px}.script-panel .button{font-size:11px;padding:8px 11px;min-height:32px;border-radius:8px}.script-text-button{border:0;background:transparent;color:#857a6e;font-size:11px;padding:7px 0}
.rebuild{flex-shrink:0;padding:12px;border-radius:8px;background:#f1e8d7;color:#846339;font-size:12px;line-height:1.7}.rebuild p{margin:0 0 8px}.message{margin:0;color:#9d4131;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.diagnostics{list-style:none;margin:0;padding:0;max-height:180px;overflow:auto;flex-shrink:0;font-size:11px;line-height:1.7}.diagnostics li{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid #e4dfd6;overflow-wrap:anywhere}.diagnostics .error b{color:#9d4131}.diagnostics .warning b{color:#846339}.diagnostics em{color:#918577;font-style:normal}
.script-panel .script-actions{display:block;flex-shrink:0;padding:12px 16px;border-top:1px solid #e4dfd6;color:#39342d}.script-actions>div:last-child{display:flex;gap:8px}.script-actions .button{flex:1}.compile-status{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:10px}.state{color:#918577}.state.ok{color:#657157}.state.stale{color:#996d3d}.ok-note{color:#918577}
@media(max-width:760px){.script-panel{width:100%;max-width:100%;height:min(70dvh,700px);flex:0 0 min(70dvh,700px);border-left:0;border-top:1px solid #d8d2c8}.script-content{padding:12px 15px}.source-area{flex-basis:260px;min-height:260px}}
</style>
