<script setup>
import { ref, computed, onMounted } from 'vue';
import { parseRecipients, missingFields } from '../lib/parse-recipients.js';

const props = defineProps({ onClose: { type: Function, required: true } });

const accounts = ref([]);
const selectedAccounts = ref([]);
const name = ref('');
const subject = ref('');
const body = ref('');
const pasted = ref('');
const minDelay = ref(45);
const maxDelay = ref(180);
const error = ref(null);
const stage = ref('compose'); // compose | sending
const progress = ref(null);

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (reply?.ok) resolve(reply.data);
      else reject(new Error(reply?.error ?? 'The extension did not respond.'));
    });
  });
}

/** Vue's compiler can't handle literal braces inside an interpolation. */
function fieldTag(field) {
  return `{${'{'}${field}}${'}'}`;
}

function insertField(field) {
  body.value += fieldTag(field);
}

onMounted(async () => {
  try {
    accounts.value = await send({ type: 'accounts:list' });
    selectedAccounts.value = accounts.value
      .filter((a) => !a.needsReconnect)
      .map((a) => a.backendId);
  } catch (err) {
    error.value = err.message;
  }
});

const parsed = computed(() => parseRecipients(pasted.value));

const unknownFields = computed(() =>
  missingFields(`${subject.value} ${body.value}`, parsed.value.fields)
);

const totalBudget = computed(() =>
  accounts.value
    .filter((a) => selectedAccounts.value.includes(a.backendId))
    .reduce((sum, a) => sum + (a.daily_remaining ?? 0), 0)
);

const overBudget = computed(
  () => parsed.value.recipients.length > totalBudget.value
);

/** Rough wall-clock estimate. People consistently expect this to be instant. */
const estimate = computed(() => {
  const count = parsed.value.recipients.length;
  if (!count) return null;

  const seconds = (count * (minDelay.value + maxDelay.value)) / 2;
  const hours = seconds / 3600;

  if (hours >= 1) return `about ${hours.toFixed(1)} hours`;
  return `about ${Math.round(seconds / 60)} minutes`;
});

const canSend = computed(
  () =>
    name.value.trim() &&
    subject.value.trim() &&
    body.value.trim() &&
    parsed.value.recipients.length > 0 &&
    selectedAccounts.value.length > 0 &&
    !unknownFields.value.length
);

// function insertField(field) {
//   body.value += `{{${field}}}`;
// }

async function start() {
  error.value = null;
  stage.value = 'sending';

  try {
    const campaign = await send({
      type: 'campaign:create',
      payload: {
        name: name.value,
        subject_template: subject.value,
        body_template: body.value,
        body_format: 'html',
        min_delay_seconds: Number(minDelay.value),
        max_delay_seconds: Number(maxDelay.value),
        mail_account_ids: selectedAccounts.value,
        recipients: parsed.value.recipients,
      },
    });

    progress.value = { uuid: campaign.uuid, sent: 0, failed: 0, total: parsed.value.recipients.length };
    poll(campaign.uuid);
  } catch (err) {
    error.value = err.message;
    stage.value = 'compose';
  }
}

async function poll(uuid) {
  try {
    const state = await send({ type: 'campaign:state', campaignUuid: uuid });
    progress.value = {
      uuid,
      sent: state.sent_count,
      failed: state.failed_count,
      total: state.total_count,
      status: state.status,
    };

    if (state.status === 'sending') setTimeout(() => poll(uuid), 5000);
  } catch (err) {
    error.value = err.message;
  }
}

const segments = computed(() => {
  if (!progress.value) return [];
  const { sent, failed, total } = progress.value;
  return Array.from({ length: total }, (_, i) => {
    if (i < sent) return 'done';
    if (i < sent + failed) return 'failed';
    return '';
  }).slice(0, 60);
});
</script>

<template>
  <div class="scrim" @click.self="props.onClose()">
    <div class="panel" role="dialog" aria-label="New Batchmail campaign">
      <div class="panel-head">
        <h2>{{ stage === 'compose' ? 'New campaign' : name }}</h2>
        <button class="close" @click="props.onClose()">Close</button>
      </div>

      <div class="panel-body">
        <p v-if="error" class="error">{{ error }}</p>

        <template v-if="stage === 'compose'">
          <div class="field">
            <label for="bm-name">Campaign name</label>
            <input id="bm-name" v-model="name" placeholder="March newsletter" />
          </div>

          <div class="field">
            <label for="bm-recipients">Recipients</label>
            <p class="help">
              Paste cells straight from a spreadsheet. The first row is used as
              column names, and every column becomes a merge field.
            </p>
            <textarea
              id="bm-recipients"
              v-model="pasted"
              class="mono"
              rows="5"
              placeholder="Name	Email	Company"
            />

            <div v-if="parsed.recipients.length" class="chips">
              <button
                v-for="field in parsed.fields"
                :key="field"
                class="chip"
                type="button"
                @click="insertField(field)"
              >
                {{ fieldTag(field) }}
              </button>
            </div>

            <p v-if="pasted && !parsed.emailField" class="warn">
              No email column found. One column needs to contain email addresses.
            </p>
            <p v-else-if="parsed.skipped.length" class="warn">
              {{ parsed.skipped.length }} row(s) skipped —
              {{ parsed.skipped[0].reason }} on line {{ parsed.skipped[0].line }}.
            </p>
          </div>

          <div class="field">
            <label for="bm-subject">Subject</label>
            <input id="bm-subject" v-model="subject" :placeholder="`Hello ${fieldTag('first_name')}`" />
          </div>

          <div class="field">
            <label for="bm-body">Message</label>
            <textarea id="bm-body" v-model="body" rows="8" />
            <p v-if="unknownFields.length" class="warn">
              Unknown merge field(s): {{ unknownFields.join(', ') }}. These would
              send as blanks.
            </p>
          </div>

          <div class="field">
            <label>Send from</label>
            <div class="chips">
              <label v-for="account in accounts" :key="account.backendId" class="chip">
                <input
                  type="checkbox"
                  :value="account.backendId"
                  v-model="selectedAccounts"
                  :disabled="account.needsReconnect"
                  style="width: auto; margin-right: 4px"
                />
                {{ account.email }}
              </label>
            </div>
          </div>

          <div class="row">
            <div class="field">
              <label for="bm-min">Minimum gap (seconds)</label>
              <input id="bm-min" v-model="minDelay" type="number" min="20" />
            </div>
            <div class="field">
              <label for="bm-max">Maximum gap (seconds)</label>
              <input id="bm-max" v-model="maxDelay" type="number" min="20" />
            </div>
          </div>

          <div v-if="parsed.recipients.length" class="summary">
            <strong>{{ parsed.recipients.length }}</strong> recipients,
            <strong>{{ totalBudget }}</strong> sends available today.
            <p v-if="overBudget" class="warn">
              More recipients than today's remaining quota. The rest will send
              tomorrow, or sooner if you connect another account.
            </p>
          </div>
        </template>

        <template v-else>
          <div class="progress">
            <div class="progress-bar">
              <span v-for="(state, i) in segments" :key="i" :class="state" />
            </div>
            <p class="progress-note">
              {{ progress?.sent ?? 0 }} of {{ progress?.total ?? 0 }} sent<span
                v-if="progress?.failed"
              >, {{ progress.failed }} failed</span
              >.
              <template v-if="progress?.status === 'completed'">Done.</template>
              <template v-else>
                Keep this tab open — sending stops when you close Chrome.
              </template>
            </p>
          </div>
        </template>
      </div>

      <div class="panel-foot">
        <span class="estimate">
          <template v-if="stage === 'compose' && estimate">
            Paced sending will take {{ estimate }}.
          </template>
        </span>
        <div class="actions">
          <button class="btn-quiet" @click="props.onClose()">
            {{ stage === 'compose' ? 'Cancel' : 'Close' }}
          </button>
          <button
            v-if="stage === 'compose'"
            class="btn"
            :disabled="!canSend"
            @click="start"
          >
            Start sending
          </button>
        </div>
      </div>
    </div>
  </div>
</template>