/**
 * The send loop.
 *
 * Claims a leased batch from the backend, sends each message through the
 * Gmail API, reports outcomes back. Holds no local queue — if this worker
 * dies mid-batch the lease expires and the work returns to the pool.
 */

import { accessTokenFor } from './auth.js';
import * as api from './api.js';

const GMAIL_SEND =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// Leave headroom so we always have time to report results before the lease
// expires. Stop claiming new work inside this window.
const LEASE_SAFETY_MARGIN_MS = 60_000;

let running = false;

export async function runCampaign(campaignUuid) {
  if (running) return;
  running = true;

  try {
    while (true) {
      const state = await api.campaignState(campaignUuid);
      if (state.status !== 'sending') break;

      const claim = await api.claim(campaignUuid, { batch_size: 5 });

      if (claim.recipients.length === 0) {
        // No budget right now, or nothing left to do.
        if (claim.retry_after_seconds) {
          await scheduleWake(campaignUuid, claim.retry_after_seconds);
        }
        break;
      }

      const results = await sendBatch(claim);
      await api.reportResults(campaignUuid, {
        lease_id: claim.lease_id,
        results,
      });

      if (results.some((r) => r.outcome === 'rate_limited')) break;
    }
  } finally {
    running = false;
  }
}

async function sendBatch(claim) {
  const leaseDeadline = new Date(claim.lease_expires_at).getTime();
  const results = [];

  for (const [i, recipient] of claim.recipients.entries()) {
    if (Date.now() > leaseDeadline - LEASE_SAFETY_MARGIN_MS) break;

    const result = await sendOne(recipient, claim.campaign);
    results.push(result);

    if (result.outcome === 'rate_limited') break;

    // No pause after the last one — the gap belongs *between* sends, and
    // sleeping here just delays reporting results by up to max_delay.
    if (i < claim.recipients.length - 1) {
      await sleep(
        jitter(claim.campaign.min_delay_seconds, claim.campaign.max_delay_seconds)
      );
    }
  }

  return results;
}

async function sendOne(recipient, campaign) {
  try {
    const token = await accessTokenFor(recipient.from_email);
    const raw = buildMessage(recipient, campaign);

    const res = await fetch(GMAIL_SEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (res.ok) {
      const body = await res.json();
      return {
        recipient_id: recipient.id,
        outcome: 'sent',
        gmail_message_id: body.id,
        gmail_thread_id: body.threadId,
      };
    }

    const error = await res.json().catch(() => ({}));
    const reason = error?.error?.errors?.[0]?.reason ?? '';
    const message = error?.error?.message ?? `HTTP ${res.status}`;

    if (isRateLimit(res.status, reason, message)) {
      return {
        recipient_id: recipient.id,
        outcome: 'rate_limited',
        error_code: reason || String(res.status),
        error_message: message,
        // Long enough that we are not nibbling at the edge of the limit.
        suggested_cooldown_seconds: res.status === 429 ? 900 : 3600,
      };
    }

    return {
      recipient_id: recipient.id,
      outcome: 'failed',
      error_code: reason || String(res.status),
      error_message: message,
    };
  } catch (err) {
    return {
      recipient_id: recipient.id,
      outcome: 'failed',
      error_code: 'client_error',
      error_message: err.message,
    };
  }
}

function isRateLimit(status, reason, message) {
  if (status === 429) return true;
  if (
    status === 403 &&
    ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(
      reason
    )
  ) {
    return true;
  }
  // Gmail sometimes surfaces the SMTP-flavoured quota error through the API.
  return /5\.4\.5|daily sending quota|limit for sending mail/i.test(message ?? '');
}

// --- Message construction -------------------------------------------------

function buildMessage(recipient, campaign) {
  const subject = render(campaign.subject_template, recipient.merge_data);
  let body = render(campaign.body_template, recipient.merge_data, {
    escape: campaign.body_format === 'html',
  });

  if (campaign.track_opens) {
    body += `<img src="${campaign.tracking_base}/t/o/${recipient.tracking_token}.gif" width="1" height="1" alt="" style="display:none">`;
  }

  const unsubscribe = `${campaign.tracking_base}/u/${recipient.tracking_token}`;

  const headers = [
    `To: ${formatAddress(recipient.name, recipient.email)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Content-Type: text/${campaign.body_format === 'html' ? 'html' : 'plain'}; charset="UTF-8"`,
    'MIME-Version: 1.0',
    // Not optional. Every bulk send needs a working opt-out, and Gmail's
    // own bulk sender requirements expect this header.
    `List-Unsubscribe: <${unsubscribe}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  ];

  if (campaign.reply_to) headers.push(`Reply-To: ${campaign.reply_to}`);

  const mime = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return base64Url(mime);
}

function render(template, data = {}, { escape = false } = {}) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = data[key] ?? '';
    return escape ? escapeHtml(String(value)) : String(value);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAddress(name, email) {
  return name ? `${encodeHeader(name)} <${email}>` : email;
}

// RFC 2047 for anything outside ASCII, so accented names don't arrive mangled.
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
}

function base64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Scheduling -----------------------------------------------------------

function jitter(minSeconds, maxSeconds) {
  return (minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * MV3 service workers get killed after ~30s idle, so anything longer than a
 * short sleep has to go through chrome.alarms. Minimum granularity is one
 * minute.
 */
async function scheduleWake(campaignUuid, seconds) {
  await chrome.alarms.create(`campaign:${campaignUuid}`, {
    delayInMinutes: Math.max(1, Math.ceil(seconds / 60)),
  });
}