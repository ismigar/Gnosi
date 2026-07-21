/* Gnosi Web Clipper — popup. Save the page (or the selection) to the vault via
 * POST {backend}/api/public/clip with Authorization: Bearer <PAT>. */

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const cfg = await chrome.storage.local.get(['backend', 'token']);
  $('backend').value = cfg.backend || 'https://localhost:5173';
  $('token').value = cfg.token || '';
}

async function saveConfig() {
  await chrome.storage.local.set({ backend: $('backend').value.trim(), token: $('token').value.trim() });
  setStatus('Configuració desada.', 'ok');
}

function setStatus(msg, cls = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSelectionText(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection ? window.getSelection().toString() : ''),
    });
    return res?.[0]?.result || '';
  } catch {
    return '';
  }
}

async function clip(onlySelection) {
  const { backend, token } = await chrome.storage.local.get(['backend', 'token']);
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
