<script setup>
import { ref, watch, onMounted } from 'vue';

/**
 * A small contenteditable editor.
 *
 * No dependency, for two reasons. CKEditor 5's open-source build is GPL,
 * which would relicense this MIT project, and every full editor is a large
 * bundle to inject into every Gmail page load.
 *
 * document.execCommand is formally deprecated but has no replacement, is
 * implemented everywhere, and behaves correctly inside a shadow root. Tiptap
 * (MIT, ProseMirror-based) is the upgrade path if this stops being enough.
 */

const props = defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const editor = ref(null);
const activeMarks = ref({});

const TOOLS = [
  { cmd: 'bold', label: 'B', title: 'Bold', style: 'font-weight:700' },
  { cmd: 'italic', label: 'I', title: 'Italic', style: 'font-style:italic' },
  { cmd: 'underline', label: 'U', title: 'Underline', style: 'text-decoration:underline' },
  { cmd: 'insertUnorderedList', label: '••', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1.', title: 'Numbered list' },
];

onMounted(() => {
  if (props.modelValue) editor.value.innerHTML = props.modelValue;
});

// Only write back when the value changed elsewhere — assigning innerHTML on
// every keystroke would collapse the caret to the start of the field.
watch(
  () => props.modelValue,
  (value) => {
    if (editor.value && value !== editor.value.innerHTML) {
      editor.value.innerHTML = value;
    }
  }
);

function sync() {
  emit('update:modelValue', editor.value.innerHTML);
  refreshMarks();
}

function refreshMarks() {
  const marks = {};
  for (const tool of TOOLS) {
    try {
      marks[tool.cmd] = document.queryCommandState(tool.cmd);
    } catch {
      marks[tool.cmd] = false;
    }
  }
  activeMarks.value = marks;
}

function run(cmd) {
  editor.value.focus();
  document.execCommand(cmd, false, null);
  sync();
}

function addLink() {
  const url = prompt('Link URL');
  if (!url) return;

  editor.value.focus();
  document.execCommand('createLink', false, url);
  sync();
}

/**
 * Paste as plain text.
 *
 * Pasting from Word or a web page otherwise drags in font tags and inline
 * styles that survive into the sent email and look broken in other clients.
 */
function onPaste(event) {
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
  sync();
}

/** Called by the parent when a merge-field chip is clicked. */
function insertAtCursor(text) {
  editor.value.focus();
  document.execCommand('insertText', false, text);
  sync();
}

defineExpose({ insertAtCursor });
</script>

<template>
  <div class="editor-shell">
    <div class="toolbar" role="toolbar" aria-label="Formatting">
      <button
        v-for="tool in TOOLS"
        :key="tool.cmd"
        type="button"
        class="tool"
        :class="{ active: activeMarks[tool.cmd] }"
        :title="tool.title"
        :style="tool.style"
        @mousedown.prevent
        @click="run(tool.cmd)"
      >
        {{ tool.label }}
      </button>

      <button type="button" class="tool" title="Insert link" @mousedown.prevent @click="addLink">
        Link
      </button>

      <span class="tool-spacer" />

      <button
        type="button"
        class="tool"
        title="Remove formatting"
        @mousedown.prevent
        @click="run('removeFormat')"
      >
        Clear
      </button>
    </div>

    <div
      ref="editor"
      class="editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      @input="sync"
      @keyup="refreshMarks"
      @mouseup="refreshMarks"
      @paste="onPaste"
    />
  </div>
</template>