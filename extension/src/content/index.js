/**
 * Batchmail inside Gmail.
 *
 * Adds a floating launcher and mounts the campaign composer in a shadow root.
 *
 * SHADOW DOM is doing real work here: Gmail ships aggressive global CSS that
 * would otherwise shred any injected UI, and a shadow root also stops our
 * styles leaking into Gmail.
 */

import { createApp } from 'vue';
import Composer from './Composer.vue';
// import panelStyles from './panel.css?inline';
import panelStyles from './panel-styles.js';

const LAUNCHER_ID = 'batchmail-launcher';
const PANEL_ID = 'batchmail-panel';

let app = null;

/**
 * A floating launcher rather than one injected into Gmail's sidebar.
 *
 * Gmail's markup is obfuscated and changes without notice — the compose
 * button's `gh="cm"` attribute was stable for years and then wasn't. Anchoring
 * to it means the button silently disappears on a Gmail redesign, which is a
 * bug users report as "the extension stopped working".
 *
 * A fixed-position button owes Gmail nothing and cannot break this way.
 */
function injectLauncher() {
  if (document.getElementById(LAUNCHER_ID)) return;

  const host = document.createElement('div');
  host.id = LAUNCHER_ID;
  host.style.cssText =
    'position: fixed; bottom: 24px; right: 24px; z-index: 9998;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      button {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 10px 16px;
        border: 1px solid #d8dce2;
        border-radius: 20px;
        background: #fff;
        color: #14171f;
        font: 550 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 2px 10px rgba(20, 23, 31, 0.12);
        cursor: pointer;
      }
      button:hover { background: #f5f7f9; }
      button:focus-visible { outline: 2px solid #0f5f5c; outline-offset: 2px; }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #0f5f5c;
      }
    </style>
    <button type="button"><span class="dot"></span>Batchmail</button>
  `;

  shadow.querySelector('button').addEventListener('click', openPanel);
  document.body.appendChild(host);
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

// Gmail is a single-page app that rebuilds large parts of the DOM on
// navigation. Debounced heavily because Gmail mutates constantly and all we
// care about is whether our button still exists.
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

console.info('[batchmail] content script ready');