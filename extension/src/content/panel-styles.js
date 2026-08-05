/**
 * Panel styles as a JS module.
 *
 * These were originally imported from panel.css with ?inline and then ?raw,
 * and both came back empty in the CRXJS content-script build — the CSS gets
 * extracted to a separate asset that the shadow root never loads. A template
 * literal is plain JavaScript, so no build step can lose it.
 */

export default `
/*
 * Injected into the panel's shadow root, so nothing here can leak into Gmail
 * and none of Gmail's global CSS can reach in.
 */

:host,
* {
  box-sizing: border-box;
}

.scrim {
  --ink: #14171f;
  --muted: #6c7484;
  --line: #e2e5ea;
  --paper: #f5f7f9;
  --surface: #ffffff;
  --accent: #0f5f5c;
  --spent: #a33a2e;
  --low: #a8761a;
  --ok: #2f7a5a;

  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1rem;
  overflow-y: auto;
  background: rgba(20, 23, 31, 0.45);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
}

.panel {
  width: 100%;
  max-width: 40rem;
  background: var(--paper);
  border-radius: 0.75rem;
  box-shadow: 0 12px 40px rgba(20, 23, 31, 0.25);
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.panel-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 620;
  letter-spacing: -0.01em;
}

.panel-body {
  padding: 1.5rem;
  display: grid;
  gap: 1.25rem;
}

.field label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 550;
  margin-bottom: 0.375rem;
}

.field .help {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0 0 0.5rem;
}

input,
textarea,
select {
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--line);
  border-radius: 0.3125rem;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 0.8125rem;
}

textarea {
  resize: vertical;
  min-height: 5rem;
}

textarea.mono,
input.mono {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.75rem;
}

:is(input, textarea, select):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}

.chip {
  padding: 0.1875rem 0.5rem;
  border-radius: 0.25rem;
  background: var(--surface);
  border: 1px solid var(--line);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.6875rem;
  color: var(--muted);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.summary {
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 0.8125rem;
}

.summary strong {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}

.warn {
  color: var(--low);
  font-size: 0.75rem;
  margin-top: 0.375rem;
}

.error {
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: #fdf0ee;
  border: 1px solid #f0cfc9;
  color: var(--spent);
  font-size: 0.8125rem;
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.estimate {
  font-size: 0.75rem;
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 0.5rem;
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
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--line);
  border-radius: 0.3125rem;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--muted);
  cursor: pointer;
}

.btn-quiet:hover {
  color: var(--ink);
  border-color: var(--muted);
}

:is(.btn, .btn-quiet):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.close {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--muted);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.progress {
  display: grid;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.progress-bar {
  display: flex;
  gap: 2px;
}

.progress-bar span {
  flex: 1;
  height: 0.375rem;
  border-radius: 1px;
  background: var(--line);
}

.progress-bar span.done {
  background: var(--ok);
}

.progress-bar span.failed {
  background: var(--spent);
}

.progress-note {
  font-size: 0.8125rem;
  color: var(--muted);
}

/* --- Rich text editor ------------------------------------------------- */

.editor-shell {
  border: 1px solid var(--line);
  border-radius: 0.3125rem;
  background: var(--surface);
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0.25rem;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}

.tool {
  min-width: 1.75rem;
  padding: 0.25rem 0.4375rem;
  border: 0;
  border-radius: 0.1875rem;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.2;
  cursor: pointer;
}

.tool:hover { background: var(--line); color: var(--ink); }
.tool.active { background: var(--accent); color: #fff; }
.tool:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

.tool-spacer { flex: 1; }

.editor {
  min-height: 9rem;
  max-height: 22rem;
  overflow-y: auto;
  padding: 0.625rem;
  font-size: 0.8125rem;
  line-height: 1.55;
  outline: none;
}

.editor:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.editor p { margin: 0 0 0.5rem; }
.editor a { color: var(--accent); }
.editor ul, .editor ol { margin: 0 0 0.5rem; padding-left: 1.25rem; }

/* --- Sheets import ----------------------------------------------------- */

.import-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.625rem;
}

.import-row input { flex: 1; }

.divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.75rem 0;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.divider::before,
.divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.ok-note {
  font-size: 0.75rem;
  color: var(--ok);
  margin-top: 0.375rem;
}
`;