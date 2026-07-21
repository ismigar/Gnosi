/* Gnosi Cite Add-in — sidebar logic
 *
 * Responsibilities:
 *   - Search the Gnosi Vault via /api/vault/search-citations
 *   - Insert formatted citation (via /api/vault/format-citation)
 *   - Insert/refresh bibliography (via /api/vault/format-bibliography)
 *   - Track inserted citations via Content Controls (Word.run)
 *
 * Mendeley-style pattern:
 *   Each inserted citation is a Word Content Control with tag
 *   `gnosi-cite:<citation_key>`, which lets us:
 *     1. Detect all citations in the document with a single call
 *     2. Re-render them if the user changes style
 *     3. Generate the bibliography by reading the tags
 *
 * NOTE: Word on the Web doesn't allow inserting/modifying "Rich Text"
 * content controls on some hosts. If the API fails, we fall back to
 * plain text.
 */
(function () {
    'use strict';

    // Backend base URL. In local sideload it's the same origin that serves
    // the sidebar. In production, it should point to the final URL.
    const API_BASE = window.location.origin;

    // Personal Access Token, stored locally by the user. Unauthenticated calls
    // only work while the backend still falls back to the legacy account; once
    // GNOSI_REQUIRE_AUTH is on they get a 401. Empty means "send nothing", so
    // an existing install keeps working untouched. The add-in runs in an Office
    // webview on a different origin, so a session cookie is not an option here.
    const TOKEN_KEY = 'gnosi.wordAddin.apiToken';
    const TOKEN_PREFIX = 'gnosi_pat_';
    const getToken = () => {
        try { return (localStorage.getItem(TOKEN_KEY) || '').trim(); } catch { return ''; }
    };
    const setToken = (raw) => {
        try {
            if (raw) localStorage.setItem(TOKEN_KEY, raw);
            else localStorage.removeItem(TOKEN_KEY);
            return true;
        } catch (err) {
            // Private browsing or a locked-down webview: storage throws instead
            // of returning null, and the token cannot be persisted at all.
            console.warn('token storage failed:', err && err.message);
            return false;
        }
    };
    // Never render the token back: only enough to tell one from another.
    const maskToken = (raw) => raw.slice(0, TOKEN_PREFIX.length + 4) + '…';
    const authHeaders = (extra) => {
        const h = Object.assign({}, extra || {});
        const t = getToken();
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    };

    let lastQuery = '';
    let lastResults = [];
    let activeIdx = 0;
    let searchTimer = null;

    // DOM refs (resolved on DOMContentLoaded because Office.onReady does it
    // before and in some browsers we mount with a delay).
    const $ = (id) => document.getElementById(id);

    function setStatus(text, kind) {
        const status = $('connection-status');
        if (!status) return;
        status.textContent = text;
        status.className = 'subtitle' + (kind ? ' ' + kind : '');
    }

    function setFooter(text) {
        const f = $('status-line');
        if (f) f.textContent = text;
    }

    // Checks reachability AND credentials. Pinging `/api/health` alone is not
    // enough: it is part of the public surface, so with GNOSI_REQUIRE_AUTH on
    // and no token it answers 200 while every real call gets a 401 — the pane
    // claimed "connected" and then silently found nothing.
    async function ping() {
        try {
            const r = await fetch(API_BASE + '/api/health', { method: 'GET' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
        } catch (err) {
            setStatus('Sense connexió amb Gnosi', 'error');
            console.warn('Gnosi ping failed:', err && err.message);
            return false;
        }
        try {
            const url = new URL(API_BASE + '/api/vault/search-citations');
            url.searchParams.set('q', '');
            url.searchParams.set('limit', '1');
            const r = await fetch(url.toString(), { headers: authHeaders() });
            if (r.status === 401 || r.status === 403) {
                setStatus(getToken() ? 'Token no vàlid' : 'Cal un token', 'error');
                openSettings();
                return false;
            }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            setStatus('Connectat a Gnosi', 'connected');
            return true;
        } catch (err) {
            setStatus('Sense connexió amb Gnosi', 'error');
            console.warn('Gnosi auth check failed:', err && err.message);
            return false;
        }
    }

    async function searchCitations(query) {
        try {
            const url = new URL(API_BASE + '/api/vault/search-citations');
            url.searchParams.set('q', query || '');
            url.searchParams.set('limit', '50');
            const r = await fetch(url.toString(), { headers: authHeaders() });
            // A 401 used to look exactly like "no results", which is the worst
            // possible way to report a missing credential.
            if (r.status === 401 || r.status === 403) {
                setStatus(getToken() ? 'Token no vàlid' : 'Cal un token', 'error');
                setFooter('Configura el token per cercar al Vault');
                openSettings();
                return [];
            }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('search failed:', err && err.message);
            return [];
        }
    }

    async function formatCitation(citationKey) {
        // Renders a single isolated citation — immediate UX on insertion. NOTE:
        // this violates the APA standard in documents with multiple citations (it doesn't do
        // author/year disambiguation or automatic `et al.`). To guarantee
        // APA compliance, the user must press "Update bibliography"
        // once all citations are inserted, which uses
        // `formatCitationsBatch()` (see below) to reprocess them
        // all together with the full context.
        try {
            const style = $('style-select').value || 'apa';
            const locale = 'ca-AD';
            const url = new URL(API_BASE + '/api/vault/format-citation');
            url.searchParams.set('key', citationKey);
            url.searchParams.set('style', style);
            url.searchParams.set('locale', locale);
            const r = await fetch(url.toString(), { headers: authHeaders() });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return data && data.formatted ? data.formatted : ('(' + citationKey + ')');
        } catch (err) {
            console.warn('format failed:', err && err.message);
            return '(' + citationKey + ')';
        }
    }

    async function formatCitationsBatch(citationKeys) {
        // Reprocesses ALL citations in the document in a single call
        // pandoc — APA-compliant: disambiguates homonymous authors, suffixes
        // `2020a`/`2020b`, applies `et al.` based on first appearance, etc.
        //
        // Response: `[{ key, ordinal, formatted, resolved }, ...]`
        // Each entry keeps its original order (including duplicates),
        // so the caller can map each Content Control to its
        // formatted version by position.
        if (!citationKeys || !citationKeys.length) return [];
        try {
            const style = $('style-select').value || 'apa';
            const locale = 'ca-AD';
            const r = await fetch(API_BASE + '/api/vault/format-citations', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ keys: citationKeys, style: style, locale: locale }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return Array.isArray(data && data.items) ? data.items : [];
        } catch (err) {
            console.warn('formatCitationsBatch failed:', err && err.message);
            return [];
        }
    }

    async function formatBibliography(citationKeys) {
        try {
            const style = $('style-select').value || 'apa';
            const locale = 'ca-AD';
            const r = await fetch(API_BASE + '/api/vault/format-bibliography', {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    keys: citationKeys,
                    style: style,
                    locale: locale,
                }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return {
                entries: (data && Array.isArray(data.entries)) ? data.entries : [],
                entriesHtml: (data && Array.isArray(data.entries_html)) ? data.entries_html : [],
                // Keys the backend could not resolve (deleted record, renamed
                // Citation Key). Surfaced in the footer after inserting —
                // otherwise the entry is silently absent from the list.
                missing: (data && Array.isArray(data.missing)) ? data.missing : [],
            };
        } catch (err) {
            console.warn('bibliography failed:', err && err.message);
            return { entries: [], entriesHtml: [], missing: [] };
        }
    }

    function renderResults(items) {
        const list = $('results');
        const empty = $('empty-state');
        if (!list || !empty) return;
        list.innerHTML = '';
        if (!items.length) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        items.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'result-item' + (idx === activeIdx ? ' active' : '');
            li.setAttribute('data-idx', String(idx));
            const meta = [item.author, item.year].filter(Boolean).join(', ');
            li.innerHTML =
                '<div class="result-key">@' + escapeHtml(item.citation_key || '') + '</div>' +
                '<div class="result-title">' + escapeHtml(item.title || '—') + '</div>' +
                (meta ? '<div class="result-meta">' + escapeHtml(meta) + '</div>' : '');
            li.addEventListener('click', () => insertCitation(item));
            li.addEventListener('mouseenter', () => {
                // We ONLY update the highlight (class 'active'); we do NOT
                // we re-render the list. Re-rendering replaces the
                // <li> under the cursor and, in Word for Mac's WebView, can
                // swallow the click (mousedown and mouseup land on elements
                // different) → the insertion never fired.
                activeIdx = idx;
                list.querySelectorAll('.result-item').forEach((el, i) => {
                    el.classList.toggle('active', i === idx);
                });
            });
            list.appendChild(li);
        });
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function returnFocusToDocument() {
        // 1) Native API: Window.setFocus() (WordApiDesktop 1.4, announced at
        //    Ignite 2025) reliably returns keyboard focus to the document
        //    body. The method hangs off document.activeWindow (a
        //    Word.Window), NOT off document. This runs in its own Word.run so
        //    that, if the build doesn't support the requirement set, the
        //    throw on sync doesn't affect the insertion.
        try {
            if (typeof Word !== 'undefined' && Word.run) {
                await Word.run(async (context) => {
                    context.document.activeWindow.setFocus();
                    await context.sync();
                });
                return;
            }
        } catch (e) {
            console.warn('Window.setFocus no disponible; fallback a blur:', e && e.message);
        }
        // 2) Fallback for older builds: window.blur() releases the WebView
        //    in some versions; harmless if not honored.
        try {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
            window.blur();
        } catch (e) { /* no-op */ }
    }

    async function insertCitation(item) {
        if (!item || !item.citation_key) return;
        setFooter('Inserint cita…');
        let text;
        try {
            text = await formatCitation(item.citation_key);
        } catch (e) {
            setFooter('Error formatant la cita: ' + (e && e.message));
            return;
        }
        const tag = 'gnosi-cite:' + item.citation_key;

        // Robust pattern for Word (including Word for Mac): insert the text
        // into the selection FIRST (sync), then in a second pass wrap it in a
        // Content Control for tracking. Creating an empty Content Control
        // over a collapsed selection (cursor only) fails in Word for Mac.
        try {
            if (typeof Word === 'undefined' || !Word.run) {
                throw new Error('API de Word no disponible');
            }
            await Word.run(async (context) => {
                const range = context.document.getSelection();
                const inserted = range.insertText(text, Word.InsertLocation.replace);
                await context.sync();
                try {
                    const cc = inserted.insertContentControl();
                    cc.tag = tag;
                    cc.title = 'Gnosi cite ' + item.citation_key;
                    // The cursor must end up AFTER the citation, OUTSIDE the
                    // content control, so the user can keep typing without
                    // the text entering the citation. RangeLocation.After is
                    // the degenerate point right after the CC.
                    cc.getRange(Word.RangeLocation.after).select();
                    await context.sync();
                } catch (ccErr) {
                    // The text is ALREADY in the document; only the tracking
                    // via Content Control fails. Either way, place the cursor at the end.
                    try {
                        inserted.getRange(Word.RangeLocation.after).select();
                        await context.sync();
                    } catch (selErr) { /* no-op */ }
                    console.warn('CC wrap failed (text inserit igualment):', ccErr && ccErr.message);
                }
            });
            // Recalculates all citations with full context (like
            // Mendeley/Zotero): APA applies 2020a/2020b, `et al.` and
            // surname disambiguation alone, without any manual action.
            await reformatAllCitations({ silent: true });
            // Returns keyboard focus to the document so the user can keep
            // typing without clicking on it. Via the native API
            // Document.setFocus() (WordApiDesktop 1.3+) with fallback to blur.
            await returnFocusToDocument();
            setFooter('Inserida @' + item.citation_key + '.');
        } catch (err) {
            console.warn('Word.run insert failed, fallback:', err && err.message);
            // Fallback: generic Office API (plain text into the selection).
            try {
                Office.context.document.setSelectedDataAsync(
                    text + ' ',
                    { coercionType: Office.CoercionType.Text },
                    (res) => {
                        if (res.status === Office.AsyncResultStatus.Failed) {
                            setFooter('No s\'ha pogut inserir (' + res.error.message + '). Fes clic dins del document, on vulguis la cita, i torna-ho a provar.');
                        } else {
                            setFooter('Cita inserida (text pla): @' + item.citation_key);
                        }
                    }
                );
            } catch (err2) {
                setFooter('Error inserint: ' + (err && err.message ? err.message : '') + (err2 ? ' / ' + err2.message : ''));
            }
        }
    }

    async function collectCitationKeysFromDocument(uniqueOnly) {
        // Iterates all Content Controls and extracts the ones that have the
        // `gnosi-cite:<key>` tag.
        //
        // `uniqueOnly=true` (default) → for the bibliography (each key
        //   appears only once, no matter how many times it's cited)
        // `uniqueOnly=false` → for batch reformatting (preserves the full
        //   order including duplicates; needed so pandoc-citeproc can do
        //   "et al." and author-year disambiguation based on the first vs
        //   subsequent appearances)
        const allowDuplicates = uniqueOnly === false;
        try {
            return await Word.run(async (context) => {
                const ccs = context.document.contentControls;
                ccs.load('items/tag');
                await context.sync();
                const seen = new Set();
                const ordered = [];
                ccs.items.forEach((cc) => {
                    const tag = String(cc.tag || '');
                    if (!tag.startsWith('gnosi-cite:')) return;
                    const key = tag.substring('gnosi-cite:'.length);
                    if (!key) return;
                    if (!allowDuplicates) {
                        if (seen.has(key)) return;
                        seen.add(key);
                    }
                    ordered.push(key);
                });
                return ordered;
            });
        } catch (err) {
            console.warn('collectCitationKeys failed:', err && err.message);
            return [];
        }
    }

    async function refreshBibliography() {
        // For the bibliography (final list in the document) each key
        // appears only once — `uniqueOnly=true` (default).
        setFooter('Llegint cites del document…');
        const keys = await collectCitationKeysFromDocument();
        if (!keys.length) {
            setFooter('No s\'han trobat cites al document.');
            // Same shape as the success path: the caller destructures
            // { entries, entriesHtml } — returning [] here made
            // `entries.length` throw an unhandled TypeError on any document
            // without citations.
            return { entries: [], entriesHtml: [], missing: [] };
        }
        setFooter('Formatant ' + keys.length + ' entrades…');
        return await formatBibliography(keys);
    }

    async function insertBibliography() {
        const { entries, entriesHtml, missing } = await refreshBibliography();
        if (!entries.length && !entriesHtml.length) return;
        const count = entriesHtml.length || entries.length;
        try {
            await Word.run(async (context) => {
                const body = context.document.body;
                body.insertParagraph('', Word.InsertLocation.end);
                const heading = body.insertParagraph('Bibliografia', Word.InsertLocation.end);
                heading.styleBuiltIn = Word.BuiltInStyleName.heading1;
                if (entriesHtml.length) {
                    // Word converts <em>/<i> into italics and <a href> into
                    // a real hyperlink. Paragraph formatting (alignment +
                    // hanging indent) is applied AFTERWARDS via Word.js, not
                    // via CSS: Word's WebView ignores text-align/margins from
                    // the HTML and, otherwise, inherits the document style's
                    // justification (huge spaces between words — not APA).
                    const html = entriesHtml.map((e) => '<p>' + e + '</p>').join('');
                    const range = body.insertHtml(html, Word.InsertLocation.end);
                    range.load('paragraphs');
                    await context.sync();
                    range.paragraphs.items.forEach((p) => {
                        p.alignment = Word.Alignment.left;   // ragged right (not justified)
                        p.leftIndent = 36;                   // 0.5" — indent base
                        p.firstLineIndent = -36;             // hanging indent APA
                        p.spaceAfter = 6;
                    });
                } else {
                    entries.forEach((entry) => {
                        const p = body.insertParagraph(entry, Word.InsertLocation.end);
                        p.styleBuiltIn = Word.BuiltInStyleName.normal;
                    });
                }
                await context.sync();
            });
            if (missing && missing.length) {
                setFooter('Bibliografia inserida amb ' + count + ' entrades. ' +
                    'Sense resoldre: ' + missing.join(', ') + '.');
            } else {
                setFooter('Bibliografia inserida amb ' + count + ' entrades.');
            }
        } catch (err) {
            setFooter('Error inserint bibliografia: ' + (err && err.message));
        }
    }

    async function reformatAllCitations(opts) {
        // Reformats ALL citations in the document with full context in a
        // single pandoc-citeproc call (in order, with duplicates): APA can
        // decide 2020a/2020b for same author+year, initials for surnames
        // homonyms and `et al.` based on first vs subsequent appearances. It's called
        // automatically after each insertion (like Mendeley/Zotero), so
        // that the user doesn't have to press any button. `silent` avoids
        // overwriting the footer message in the automatic flow.
        const silent = !!(opts && opts.silent);
        if (typeof Word === 'undefined' || !Word.run) return;
        try {
            await Word.run(async (context) => {
                const ccs = context.document.contentControls;
                ccs.load('items/tag');
                await context.sync();
                const targets = [];  // [{cc, key}] in document order
                ccs.items.forEach((cc) => {
                    const tag = String(cc.tag || '');
                    if (!tag.startsWith('gnosi-cite:')) return;
                    const key = tag.substring('gnosi-cite:'.length);
                    if (!key) return;
                    targets.push({ cc, key });
                });
                if (!targets.length) return;
                const keys = targets.map((t) => t.key);
                const formatted = await formatCitationsBatch(keys);
                if (!formatted.length) return;
                // Mapping by ordinal — preserves duplicates and document order.
                targets.forEach((t, idx) => {
                    const item = formatted[idx];
                    if (!item) return;
                    try {
                        t.cc.insertText(item.formatted, Word.InsertLocation.replace);
                    } catch (e) {
                        console.warn('Failed to replace CC text:', e && e.message);
                    }
                });
                await context.sync();
            });
            if (!silent) setFooter('Cites actualitzades (APA).');
        } catch (err) {
            if (silent) console.warn('reformatAllCitations failed:', err && err.message);
            else setFooter('Error actualitzant cites: ' + (err && err.message));
        }
    }

    function openSettings() {
        const box = $('settings');
        if (box) box.open = true;
    }

    // Reflects what is stored, never the value itself.
    function renderTokenState() {
        const state = $('token-state');
        if (!state) return;
        const raw = getToken();
        state.textContent = raw ? 'Token desat: ' + maskToken(raw) : 'Sense token';
        state.className = 'settings-state ' + (raw ? 'saved' : 'missing');
        const clear = $('token-clear');
        if (clear) clear.disabled = !raw;
    }

    function bindSettings() {
        const input = $('token-input');
        const save = $('token-save');
        const clear = $('token-clear');

        const saveToken = async () => {
            const raw = String((input && input.value) || '').trim();
            if (!raw) return;
            if (!raw.startsWith(TOKEN_PREFIX)) {
                setFooter('Això no sembla un token de Gnosi (ha de començar per ' + TOKEN_PREFIX + ')');
                return;
            }
            if (!setToken(raw)) {
                setFooter('Aquest navegador no permet desar el token');
                return;
            }
            // Clear the field: the value is stored, and leaving a credential on
            // screen in a pane that stays open is needless exposure.
            if (input) input.value = '';
            renderTokenState();
            setFooter('Token desat');
            // Re-check with the new credential and reload what the search found
            // nothing of while unauthenticated.
            if (await ping()) {
                const items = await searchCitations('');
                lastResults = items;
                activeIdx = 0;
                renderResults(items);
            }
        };

        if (save) save.addEventListener('click', saveToken);
        if (input) input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveToken(); }
        });
        if (clear) clear.addEventListener('click', () => {
            setToken('');
            renderTokenState();
            setFooter('Token esborrat');
            ping();
        });
        renderTokenState();
    }

    function bindUI() {
        bindSettings();
        const input = $('search-input');
        if (input) {
            input.addEventListener('input', (e) => {
                lastQuery = String(e.target.value || '');
                if (searchTimer) clearTimeout(searchTimer);
                searchTimer = setTimeout(async () => {
                    lastResults = await searchCitations(lastQuery);
                    activeIdx = 0;
                    renderResults(lastResults);
                }, 200);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = Math.min(activeIdx + 1, Math.max(lastResults.length - 1, 0));
                    renderResults(lastResults);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = Math.max(activeIdx - 1, 0);
                    renderResults(lastResults);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const item = lastResults[activeIdx];
                    if (item) insertCitation(item);
                }
            });
        }

        const insertBibBtn = $('insert-bibliography');
        if (insertBibBtn) insertBibBtn.addEventListener('click', insertBibliography);

        // When changing the style (APA → Chicago…), reformats the citations already
        // inserted so the change propagates without manual action.
        const styleSelect = $('style-select');
        if (styleSelect) styleSelect.addEventListener('change', () => {
            reformatAllCitations({ silent: false });
        });
    }

    // Ask Word to reopen this pane on its own the next time the document is
    // opened. On macOS a sideloaded add-in loses its ribbon button as soon as
    // Word quits, so without this the pane has to be re-inserted from
    // "Developer Add-ins" every single session. The manifest designates this
    // pane as the autoopen target; here we tag the document that pairs with it.
    //
    // The tag travels inside the document, so it only survives if the user
    // saves. A brand-new unsaved document still needs one manual insertion.
    const AUTO_OPEN_SETTING = 'Office.AutoShowTaskpaneWithDocument';
    function tagDocumentForAutoOpen() {
        const settings = Office.context && Office.context.document && Office.context.document.settings;
        if (!settings) return;
        try {
            if (settings.get(AUTO_OPEN_SETTING) === true) return;
            settings.set(AUTO_OPEN_SETTING, true);
            settings.saveAsync((result) => {
                if (result.status !== Office.AsyncResultStatus.Succeeded) {
                    console.error('Gnosi Cite: could not tag the document for auto-open', result.error);
                }
            });
        } catch (err) {
            console.error('Gnosi Cite: auto-open tagging failed', err);
        }
    }

    // Office.onReady guarantees that the API is available. It's also
    // fires outside Word (for testing in the browser) — in this case
    // info.host will be null and Word.run operations will fail with a
    // informative error (the setSelectedDataAsync fallback must be used).
    Office.onReady((info) => {
        setFooter('Host: ' + (info && info.host ? info.host : 'browser'));
        if (info && info.host) tagDocumentForAutoOpen();
        bindUI();
        ping();
        // Initial load without filter — first 50 by popularity.
        searchCitations('').then((items) => {
            lastResults = items;
            activeIdx = 0;
            renderResults(items);
        });
    });
})();
