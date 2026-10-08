<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/csharp/register'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/find/browser/findController'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

const props = defineProps<{ modelValue: string; disabled?: boolean; visible?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: [] }>()
const container = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | undefined
let model: monaco.editor.ITextModel | undefined
let change: monaco.IDisposable | undefined
let syncing = false
let layoutFrame = 0

self.MonacoEnvironment = { ...self.MonacoEnvironment, getWorker: () => new EditorWorker() }
onMounted(() => {
  monaco.editor.defineTheme('tomcat-editor', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': '#2b2b2b', 'editor.foreground': '#d4d4d4',
      'editorGutter.background': '#2b2b2b', 'editorLineNumber.foreground': '#929292',
      'editorLineNumber.activeForeground': '#f3f3f3', 'editor.lineHighlightBackground': '#353535',
      'editor.selectionBackground': '#2c5d87', 'editor.inactiveSelectionBackground': '#3b4d5d',
      'editorWidget.background': '#383838', 'editorWidget.border': '#555555',
      'input.background': '#282828', 'input.foreground': '#f3f3f3', 'input.border': '#555555',
      'focusBorder': '#76b9ec', 'scrollbarSlider.background': '#73737380',
    },
  })
  model = monaco.editor.createModel(props.modelValue, 'csharp')
  model.updateOptions({ tabSize: 4, insertSpaces: true })
  editor = monaco.editor.create(container.value!, {
    model, theme: 'tomcat-editor', ariaLabel: 'C# 脚本源码',
    readOnly: props.disabled, automaticLayout: true,
    fontFamily: 'Consolas, "Cascadia Code", monospace', fontSize: 13, lineHeight: 22,
    minimap: { enabled: false }, lineNumbers: 'on', lineNumbersMinChars: 3,
    scrollBeyondLastLine: false, wordWrap: 'off', padding: { top: 12, bottom: 12 },
    renderLineHighlight: 'line', bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true },
    stickyScroll: { enabled: false }, contextmenu: false,
    // Keep a textarea input for IME and assistive technology on supported browsers.
    editContext: false,
  })
  change = editor.onDidChangeModelContent(() => {
    if (!syncing) emit('update:modelValue', editor!.getValue())
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (!props.disabled) emit('save')
  })
})
watch(() => props.modelValue, value => {
  if (!model || model.getValue() === value) return
  syncing = true
  model.setValue(value)
  syncing = false
})
watch(() => props.disabled, readOnly => editor?.updateOptions({ readOnly }))
watch(() => props.visible, visible => {
  if (visible) layoutFrame = requestAnimationFrame(() => editor?.layout())
})
onBeforeUnmount(() => {
  cancelAnimationFrame(layoutFrame)
  change?.dispose()
  editor?.dispose()
  model?.dispose()
})
</script>
<template><div ref="container" class="code-editor" @keydown.stop /></template>
<style scoped>
.code-editor{position:relative;flex:1;min-width:0;min-height:200px;overflow:hidden;background:var(--editor-field,#2b2b2b)}
</style>
