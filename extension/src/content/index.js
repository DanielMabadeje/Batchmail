/**
 * Batchmail inside Gmail.
 *
 * Injects a launcher button next to Compose and mounts the campaign composer
 * in a shadow root.
 *
 * Two things make this survive contact with Gmail:
 *
 * 1. SHADOW DOM. Gmail ships aggressive global CSS that would otherwise
 *    shred any injected UI. A shadow root isolates ours completely — and
 *    also stops our styles leaking into Gmail.
 *
 * 2. MUTATION OBSERVER. Gmail is a single-page app that tears down and
 *    rebuilds its chrome constantly. A button injected once will vanish, so
 *    we re-check and re-inject whenever the DOM changes.
 */

import { createApp } from 'vue';
import Composer from './Composer.vue';
import panelStyles from './panel.css?inline';

// Gmail's markup is obfuscated, but the compose button has carried this
// attribute for years. It is the most stable anchor available.
const COMPOSE_SELECTOR = '[gh="cm"]';

const LAUNCHER_ID = 'batchmail-launcher';
const PANEL_ID = 'batchmail-panel';

let app = null;

function injectLauncher() {
  if (document.getElementById(LAUNCHER_ID)) return;

  const compose = document.querySelector(COMPOSE_SELECTOR);
  if (!compose) return;

  const container = compose.closest('div')?.parentElement;
  if (!container) return;

  const host = document.createElement('div');
  host.id = LAUNCHER_ID;
  host.style.cssText = 'margin: 8px 0 0 12px;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border: 1px solid #d8dce2;
        border-radius: 16px;
        background: #fff;
        color: #14171f;
        font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      button:hover { background: #f5f7f9; }
      button:focus-visible { outline: 2px solid #0f5f5c; outline-offset: 2px; }
      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #0f5f5c;
      }
    </style>
    <button type="button"><span class="dot"></span>Batchmail</button>
  `;

  shadow.querySelector('button').addEventListener('click', openPanel);
  container.appendChild(host);
}

function openPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const host = document.createElement('div');
  host.id = PANEL_ID;
  // Above Gmail's own overlays, which sit around 1000.
  host.style.cssText = 'position: fixed; inset: 0; z-index: 9999;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = panelStyles;
  shadow.appendChild(style);

  const mount = document.createElement('div');
  shadow.appendChild(mount);
  document.body.appendChild(host);

  app = createApp(Composer, { onClose: closePanel });
  app.mount(mount);
}

function closePanel() {
  app?.unmount();
  app = null;
  document.getElementById(PANEL_ID)?.remove();
}

// Gmail rebuilds its chrome on navigation, so one injection is never enough.
// Debounced because Gmail mutates the DOM constantly and we only care that
// the button still exists.
let pending = null;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    injectLauncher();
  }, 300);
});

observer.observe(document.body, { childList: true, subtree: true });
injectLauncher();