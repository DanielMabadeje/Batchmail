<script setup>
import { ref, onMounted } from 'vue';

const accounts = ref([]);
const loading = ref(true);

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      reply?.ok ? resolve(reply.data) : reject(new Error(reply?.error ?? 'No response'));
    });
  });
}

onMounted(async () => {
  accounts.value = await send({ type: 'accounts:list' });
  loading.value = false;
});

async function connect() {
  await send({ type: 'accounts:connect' });
  accounts.value = await send({ type: 'accounts:list' });
}
</script>

<template>
  <main>
    <h1>Batchmail</h1>
    <p v-if="loading">Loading…</p>
    <ul v-else>
      <li v-for="account in accounts" :key="account.email">
        {{ account.email }}
        <span v-if="account.needsReconnect">— reconnect needed</span>
      </li>
    </ul>
    <button @click="connect">Connect a Gmail account</button>
  </main>
</template>