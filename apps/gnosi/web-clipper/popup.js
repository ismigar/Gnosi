/* Gnosi Web Clipper — popup. Save the page (or the selection) to the vault via
 * POST {backend}/api/public/clip with Authorization: Bearer <PAT>.
 *
 * Where the clip lands is decided in Gnosi (Settings → Plugins → Web Clipper),
 * not here: GET /api/public/clip/config returns the destination table and the
 * columns to prompt for, and this popup renders that form dynamically. */

/* Firefox and Safari expose the WebExtension API as `browser` (promise-based);
 * Chromium exposes it as `chrome`, which is promise-based too under MV3. Bind
 * once so the rest of the file is browser-agnostic. */
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

/* Columns of the destination table, as served by /api/public/clip/config. Empty
 * until the popup loads them; a failed load leaves the classic form working. */
let clipFields = [];

async function loadConfig() {
  const cfg = await api.storage.local.get(['backend', 'token']);
  $('backend').value = cfg.backend || 'https://localhost:5173';
  $('token').value = cfg.token || '';
}

/* Firefox treats host_permissions as opt-in: they are listed in the manifest but
 * not granted until the user says so, and fetch() to an ungranted origin fails.
 * Ask for the configured backend origin while we still hold the click gesture
 * (permissions.request() requires one). Chromium grants them up front, so the
 * call resolves true immediately and nothing is shown. */
async function ensureBackendPermission(backend) {
  if (!api.permissions?.request) return true;
  let origin;
  try {
    origin = new URL(backend).origin + '/*';
  } catch {
    return true; // Malformed URL: let the clip attempt surface the error.
  }
  try {
    if (await api.permissions.contains({ origins: [origin] })) return true;
    return await api.permissions.request({ origins: [origin] });
  } catch (e) {
    console.warn('Could not check host permission for', origin, e);
    return true;
  }
}

async function saveConfig() {
  const backend = $('backend').value.trim();
  const granted = await ensureBackendPermission(backend);
  await api.storage.local.set({ backend, token: $('token').value.trim() });
  setStatus(
    granted
      ? 'Settings saved.'
      : 'Saved, but the browser did not grant permission for this domain.',
    granted ? 'ok' : 'err',
  );
  // New credentials may point at another vault: re-read the destination.
  await loadClipSchema();
}

function setStatus(msg, cls = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
}

async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSelectionText(tabId) {
  try {
    const res = await api.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection ? window.getSelection().toString() : ''),
    });
    return res?.[0]?.result || '';
  } catch {
    return '';
  }
}

/* Renders one control per configured column. Element ids are prefixed so a
 * column named e.g. "note" cannot collide with the popup's own inputs. */
function renderFields(fields) {
  const host = $('fields');
  if (!host) return;
  host.textContent = '';
  for (const field of fields) {
    const label = document.createElement('label');
    label.textContent = field.name || field.id;
    label.htmlFor = 'fld:' + field.id;
    host.appendChild(label);

    let input;
    if (Array.isArray(field.options) && field.options.length) {
      input = document.createElement('select');
      // Blank first option: an unfilled column stays empty instead of silently
      // taking the first value of the catalog.
      for (const opt of ['', ...field.options]) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt || '—';
        input.appendChild(option);
      }
      if (field.type === 'multi_select') input.multiple = true;
    } else if (field.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
    } else {
      input = document.createElement('input');
      input.type = field.type === 'number' ? 'number'
        : field.type === 'date' ? 'date'
          : field.type === 'datetime' ? 'datetime-local'
            : field.type === 'url' ? 'url' : 'text';
    }
    input.id = 'fld:' + field.id;
    host.appendChild(input);
  }
}

/* Value of a rendered control, in the shape the backend coerces from. */
function readField(field) {
  const el = $('fld:' + field.id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  if (el.multiple) return Array.from(el.selectedOptions).map((o) => o.value).filter(Boolean);
  return el.value;
}

function collectFields() {
  const out = {};
  for (const field of clipFields) {
    const value = readField(field);
    if (value === '' || value === false || (Array.isArray(value) && !value.length)) continue;
    out[field.id] = value;
  }
  return out;
}

/* Asks Gnosi where clips go and which columns to prompt for. A failure is
 * logged but never blocks clipping: the backend applies its own configuration
 * regardless of what the popup managed to render. */
async function loadClipSchema() {
  const { backend, token } = await api.storage.local.get(['backend', 'token']);
  clipFields = [];
  renderFields([]);
  $('target').textContent = '';
  if (!backend || !token) return;
  try {
    const resp = await fetch(backend.replace(/\/$/, '') + '/api/public/clip/config', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!resp.ok) {
      if (resp.status === 401) setStatus('Invalid or revoked token (401).', 'err');
      return;
    }
    const data = await resp.json();
    const disabled = data.enabled === false;
    $('clip').disabled = disabled;
    $('clipSelection').disabled = disabled;
    if (disabled) {
      $('target').textContent = 'Web Clipper is disabled in Gnosi.';
      return;
    }
    $('target').textContent = data.table?.name
      ? 'Destination: ' + data.table.name
      : 'Destination: Clips/ folder';
    clipFields = Array.isArray(data.fields) ? data.fields : [];
    renderFields(clipFields);
  } catch (e) {
    console.warn('Could not load the clipper configuration', e);
  }
}

async function clip(onlySelection) {
  const { backend, token } = await api.storage.local.get(['backend', 'token']);
  if (!backend || !token) {
    setStatus('Configure the URL and token first (Settings).', 'err');
    return;
  }
  setStatus('Saving…');
  const tab = await getActiveTab();
  const selection = await getSelectionText(tab.id);
  const note = $('note').value.trim();
  let content = note;
  if (onlySelection) content = selection || note;
  else content = [note, selection].filter(Boolean).join('\n\n');

  const tags = $('tags').value.split(',').map((t) => t.trim()).filter(Boolean);

  try {
    const resp = await fetch(backend.replace(/\/$/, '') + '/api/public/clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        url: tab.url, title: tab.title, content, tags, fields: collectFields(),
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setStatus('✓ Saved to ' + (data.table || data.path || 'Clips/'), 'ok');
    } else if (resp.status === 401) {
      setStatus('Invalid or revoked token (401).', 'err');
    } else if (resp.status === 403) {
      setStatus('Web Clipper is disabled in Gnosi.', 'err');
    } else {
      setStatus('Error ' + resp.status + ' while saving.', 'err');
    }
  } catch (e) {
    setStatus('Could not connect to Gnosi: ' + e.message, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadClipSchema();
  $('save').addEventListener('click', saveConfig);
  $('clip').addEventListener('click', () => clip(false));
  $('clipSelection').addEventListener('click', () => clip(true));
});
