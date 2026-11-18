<template>
  <section class="todo">
    <input v-model.trim="draft" placeholder="新任务" @keyup.enter="add" />
    <ul>
      <li v-for="item in remaining" :key="item.id" @click="item.done = !item.done">
        {{ item.title }}
      </li>
    </ul>
    <p v-if="!remaining.length">全部完成 🎉</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Item { id: number; title: string; done: boolean }

const draft = ref('')
const items = ref<Item[]>([{ id: 1, title: '写周报', done: false }])
const remaining = computed(() => items.value.filter((i) => !i.done))

function add() {
  if (!draft.value) return
  items.value.push({ id: Date.now(), title: draft.value, done: false })
  draft.value = ''
}
</script>

<style scoped>
.todo li { cursor: pointer; padding: 4px 0; }
</style>
