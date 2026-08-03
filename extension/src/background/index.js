/**
 * Service worker entry point.
 *
 * MV3 workers are killed after roughly 30 seconds idle and restarted on the
 * next event, so nothing lives in module scope that we can't rebuild. All
 * durable state is in chrome.storage or on the backend.
 */

import { connectAccount, disconnectAccount, listAccounts } from './auth.js';
import { runCampaign } from './sender.js';

// --- Messages from popup / options / content script -----------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  // Keeps the message channel open for the async response above.
  return true;
});

async function handle(message) {
  switch (message.type) {
    case 'accounts:list':
      return listAccounts();

    case 'accounts:connect':
      return connectAccount({ loginHint: message.loginHint });

    case 'accounts:disconnect':
      return disconnectAccount(message.email);

    case 'campaign:start':
      // Deliberately not awaited — the popup shouldn't hang for the duration
      // of a campaign. Progress is polled from the backend instead.
      runCampaign(message.campaignUuid);
      return { started: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// --- Alarm-driven resumption ---------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith('campaign:')) return;
  const uuid = alarm.name.slice('campaign:'.length);
  runCampaign(uuid);
});

// On browser start or extension update, pick up anything left mid-flight.
chrome.runtime.onStartup.addListener(resumeActive);
chrome.runtime.onInstalled.addListener(resumeActive);

async function resumeActive() {
  const { activeCampaigns = [] } = await chrome.storage.local.get('activeCampaigns');
  for (const uuid of activeCampaigns) {
    runCampaign(uuid);
  }
}