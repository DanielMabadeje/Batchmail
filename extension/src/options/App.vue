<script setup>
import { ref, onMounted, computed } from 'vue';

const backendUrl = ref('');
const savedUrl = ref('');
const accounts = ref([]);
const loading = ref(true);
const error = ref(null);
const busy = ref(false);

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (reply?.ok) {
        resolve(reply.data);
      } else {
        reject(new Error(reply?.error ?? 'The extension did not respond.'));
      }
    });
  });
}

async function load() {
  error.value = null;
  try {
    const { backendUrl: stored } = await chrome.storage.local.get('backendUrl');
    backendUrl.value = stored ?? import.meta.env.VITE_API_BASE_URL ?? '';
    savedUrl.value = backendUrl.value;
    accounts.value = await send({ type: 'accounts:list' });
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const urlChanged = computed(() => backendUrl.value !== savedUrl.value);

async function saveBackend() {
  await chrome.storage.local.set({ backendUrl: backendUrl.value.replace(/\/$/, '') });
  savedUrl.value = backendUrl.value;
}

async function connect() {
  busy.value = true;
  error.value = null;
  try {
    await send({ type: 'accounts:connect' });
    accounts.value = await send({ type: 'accounts:list' });
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function reconnect(email) {
  busy.value = true;
  try {
    await send({ type: 'accounts:connect', loginHint: email });
    accounts.value = await send({ type: 'accounts:list' });
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function disconnect(email) {
  await send({ type: 'accounts:disconnect', email });
  accounts.value = await send({ type: 'accounts:list' });
}

// The quota meter is segmented rather than continuous because sends are
// discrete. Each block is one tenth of the account's daily allowance.
function segments(account) {
  const cap = account.dailyCap ?? 400;
  const used = account.usedToday ?? 0;
  const filled = Math.min(10, Math.round((used / cap) * 10));
  return Array.from({ length: 10 }, (_, i) => i < filled);
}

function budgetState(account) {
  const cap = account.dailyCap ?? 400;
  const used = account.usedToday ?? 0;
  const ratio = used / cap;
  if (account.throttledUntil) return 'throttled';
  if (ratio >= 0.9) return 'spent';
  if (ratio >= 0.7) return 'low';
  return 'ok';
}

function remaining(account) {
  const cap = account.dailyCap ?? 400;
  const used = account.usedToday ?? 0;
  return Math.max(0, cap - used);
}
</script>

<template>
  <div class="page">
    <header class="masthead">
      <h1>Batchmail</h1>
      <p class="tagline">Sending runs through your own Gmail account, at your own pace.</p>
    </header>

    <p v-if="error" class="notice" role="alert">{{ error }}</p>

    <section class="block">
      <h2>Backend</h2>
      <p class="hint">
        Where campaign data is stored. Your own server if you self-host.
      </p>

      <div class="field">
        <label for="backend">Server address</label>
        <input
          id="backend"
          v-model="backendUrl"
          type="url"
          spellcheck="false"
          placeholder="http://localhost:8000"
        />
      </div>

      <button class="btn" :disabled="!urlChanged" @click="saveBackend">
        Save address
      </button>
    </section>

    <section class="block">
      <h2>Gmail accounts</h2>
      <p class="hint">
        Connect more than one to spread a campaign across them. Gmail counts
        its limits per account, so rotating is the only way to send more in a
        day.
      </p>

      <p v-if="loading" class="hint">Loading accounts…</p>

      <p v-else-if="accounts.length === 0" class="empty">
        No accounts yet. Connect one to start sending.
      </p>

      <ul v-else class="accounts">
        <li v-for="account in accounts" :key="account.email" class="account">
          <div class="account-head">
            <span class="email">{{ account.email }}</span>
            <button class="btn-quiet" @click="disconnect(account.email)">
              Disconnect
            </button>
          </div>

          <div v-if="account.needsReconnect" class="reconnect">
            <span>Google revoked this connection.</span>
            <button class="btn-quiet" :disabled="busy" @click="reconnect(account.email)">
              Reconnect
            </button>
          </div>

          <div v-else class="meter" :data-state="budgetState(account)">
            <div class="segments" role="img"
                 :aria-label="`${remaining(account)} sends left today`">
              <span
                v-for="(filled, i) in segments(account)"
                :key="i"
                class="segment"
                :class="{ filled }"
              />
            </div>
            <span class="count">{{ remaining(account) }} left today</span>
          </div>
        </li>
      </ul>

      <button class="btn" :disabled="busy" @click="connect">
        {{ busy ? 'Waiting for Google…' : 'Connect a Gmail account' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.page {
  --ink: #14171f;
  --muted: #6c7484;
  --line: #e2e5ea;
  --paper: #f5f7f9;
  --surface: #ffffff;
  --accent: #0f5f5c;
  --ok: #2f7a5a;
  --low: #a8761a;
  --spent: #a33a2e;

  box-sizing: border-box;
  max-width: 38rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 0.9375rem;
  line-height: 1.55;
  min-height: 100vh;
}

.page :is(h1, h2, p, ul) {
  margin: 0;
}

.masthead {
  margin-bottom: 2.5rem;
}

.masthead h1 {
  font-size: 1.5rem;
  font-weight: 620;
  letter-spacing: -0.02em;
}

.tagline {
  color: var(--muted);
  margin-top: 0.25rem;
}

.block {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
}

.block h2 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.hint {
  color: var(--muted);
  margin-top: 0.5rem;
  max-width: 54ch;
}

.field {
  margin: 1.25rem 0 1rem;
}

.field label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 550;
  margin-bottom: 0.375rem;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--line);
  border-radius: 0.3125rem;
  font: inherit;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.8125rem;
  background: var(--paper);
  color: var(--ink);
}

.field input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  background: var(--surface);
}

.btn {
  padding: 0.5rem 0.875rem;
  border: 0;
  border-radius: 0.3125rem;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 550;
  cursor: pointer;
}

.btn:disabled {
  background: var(--line);
  color: var(--muted);
  cursor: default;
}

.btn:not(:disabled):hover {
  background: #0c4a48;
}

.btn-quiet {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.btn-quiet:not(:disabled):hover {
  color: var(--ink);
}

:where(.btn, .btn-quiet):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.empty {
  color: var(--muted);
  padding: 1.25rem 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin: 1.25rem 0;
}

.accounts {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0;
}

.account {
  padding: 0.875rem 0;
  border-top: 1px solid var(--line);
}

.account:last-child {
  border-bottom: 1px solid var(--line);
}

.account-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.email {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.8125rem;
}

.reconnect {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  color: var(--spent);
}

/* Segmented rather than a smooth bar: sends are discrete, and a paced
   sender depletes quota in visible steps rather than sliding. */
.meter {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.625rem;
}

.segments {
  display: flex;
  gap: 2px;
}

.segment {
  width: 1.125rem;
  height: 0.375rem;
  border-radius: 1px;
  background: var(--line);
}

.meter[data-state="ok"] .segment.filled { background: var(--ok); }
.meter[data-state="low"] .segment.filled { background: var(--low); }
.meter[data-state="spent"] .segment.filled { background: var(--spent); }
.meter[data-state="throttled"] .segment { background: var(--spent); opacity: 0.35; }

.count {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.75rem;
  color: var(--muted);
}

.notice {
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: #fdf0ee;
  border: 1px solid #f0cfc9;
  color: var(--spent);
  font-size: 0.8125rem;
  margin-bottom: 1.25rem;
}
</style>