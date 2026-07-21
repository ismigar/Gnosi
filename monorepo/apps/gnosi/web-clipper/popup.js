/* Gnosi Web Clipper — popup. Save the page (or the selection) to the vault via
 * POST {backend}/api/public/clip with Authorization: Bearer <PAT>. */

/* Firefox and Safari expose the WebExtension API as `browser` (promise-based);
 * Chromium exposes it as `chrome`, which is promise-based too under MV3. Bind
 * once so the rest of the file is browser-agnostic. */
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

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
      ? 'Configuració desada.'
      : 'Desada, però el navegador no ha donat permís per a aquest domini.',
    granted ? 'ok' : 'err',
  );
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

async function clip(onlySelection) {
  const { backend, token } = await api.storage.local.get(['backend', 'token']);
  if (!backend || !token) {
    setStatus('Configura primer l\'URL i el token (Configuració).', 'err');
    return;
  }
  setStatus('Desant…');
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
      body: JSON.stringify({ url: tab.url, title: tab.title, content, tags }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setStatus('✓ Desat a ' + (data.path || 'Clips/'), 'ok');
    } else if (resp.status === 401) {
      setStatus('Token invàlid o revocat (401).', 'err');
    } else {
      setStatus('Error ' + resp.status + ' en desar.', 'err');
    }
  } catch (e) {
    setStatus('No s\'ha pogut connectar amb Gnosi: ' + e.message, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  $('save').addEventListener('click', saveConfig);
  $('clip').addEventListener('click', () => clip(false));
  $('clipSelection').addEventListener('click', () => clip(true));
});
