/* Gnosi Cite Add-in — lògica de la sidebar
 *
 * Responsabilitats:
 *   - Cerca al Vault de Gnosi via /api/vault/search-citations
 *   - Inserció de cita formatada (via /api/vault/format-citation)
 *   - Inserció/refresc de bibliografia (via /api/vault/format-bibliography)
 *   - Tracking de cites inserides via Content Controls (Word.run)
 *
 * Patró Mendeley-style:
 *   Cada cita inserida és un Content Control de Word amb tag
 *   `gnosi-cite:<citation_key>`, que ens permet:
 *     1. Detectar totes les cites del document amb una sola crida
 *     2. Re-renderitzar-les si l'usuari canvia d'estil
 *     3. Generar la bibliografia consultant els tags
 *
 * NOTA: Word per a la Web no permet inserir/modificar content controls
 * de tipus "Rich Text" en alguns hosts. Si la API falla, caiem al text
 * pla com a fallback.
 */
(function () {
    'use strict';

    // Backend base URL. En sideload local és el mateix origin que serveix
    // la sidebar. En producció, hauria d'apuntar a la URL definitiva.
    const API_BASE = window.location.origin;

    let lastQuery = '';
    let lastResults = [];
    let activeIdx = 0;
    let searchTimer = null;

    // Refs DOM (resolts en DOMContentLoaded perquè l'Office.onReady ho fa
    // abans i alguns navegadors muntem amb retard).
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

    async function ping() {
        try {
            const r = await fetch(API_BASE + '/api/health', { method: 'GET' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            setStatus('Connectat a Gnosi', 'connected');
            return true;
        } catch (err) {
            setStatus('Sense connexió amb Gnosi', 'error');
            console.warn('Gnosi ping failed:', err && err.message);
            return false;
        }
    }

    async function searchCitations(query) {
        try {
            const url = new URL(API_BASE + '/api/vault/search-citations');
            url.searchParams.set('q', query || '');
            url.searchParams.set('limit', '50');
            const r = await fetch(url.toString());
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('search failed:', err && err.message);
            return [];
        }
    }

    async function formatCitation(citationKey) {
        // Renderitza una cita aïllada — UX immediata en la inserció. NOTA:
        // això viola la norma APA en documents amb cites múltiples (no fa
        // desambiguació autor/any ni `et al.` automàtic). Per garantir
        // conformitat APA, l'usuari ha de prémer "Actualitza bibliografia"
        // un cop té totes les cites inserides, que fa servir
        // `formatCitationsBatch()` (vegis més avall) per reprocessar-les
        // totes juntes amb el context complet.
        try {
            const style = $('style-select').value || 'apa';
            const locale = 'ca-AD';
            const url = new URL(API_BASE + '/api/vault/format-citation');
            url.searchParams.set('key', citationKey);
            url.searchParams.set('style', style);
            url.searchParams.set('locale', locale);
            const r = await fetch(url.toString());
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            return data && data.formatted ? data.formatted : ('(' + citationKey + ')');
        } catch (err) {
            console.warn('format failed:', err && err.message);
            return '(' + citationKey + ')';
        }
    }

    async function formatCitationsBatch(citationKeys) {
        // Reprocessa TOTES les cites del document en una sola crida
        // pandoc — APA-conforme: desambigua autors homònims, sufixa
        // `2020a`/`2020b`, aplica `et al.` segons primera aparició, etc.
        //
        // Resposta: `[{ key, ordinal, formatted, resolved }, ...]`
        // Cada entrada conserva l'ordre original (incloent duplicats),
        // així que el caller pot mapar cada Content Control a la seva
        // versió formatada per posició.
        if (!citationKeys || !citationKeys.length) return [];
        try {
            const style = $('style-select').value || 'apa';
            const locale = 'ca-AD';
            const r = await fetch(API_BASE + '/api/vault/format-citations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
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
            };
        } catch (err) {
            console.warn('bibliography failed:', err && err.message);
            return { entries: [], entriesHtml: [] };
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
                // NOMÉS actualitzem el realçat (classe 'active'); NO
                // re-renderitzem la llista. Re-renderitzar substitueix els
                // <li> sota el cursor i, al WebView de Word per Mac, pot
                // empassar-se el clic (mousedown i mouseup cauen en elements
                // diferents) → la inserció no es disparava mai.
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

    function returnFocusToDocument() {
        // Best-effort: torna el focus del teclat del taskpane al document.
        // No hi ha API oficial a Word d'escriptori; window.blur() és el
        // workaround més fiable i és innocu si la build no el respecta.
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

        // Patró robust per a Word (inclòs Word per Mac): inserir el text a la
        // selecció PRIMER (sync), i en una segona passada embolcallar-lo en
        // un Content Control per al seguiment. Crear un Content Control buit
        // sobre una selecció col·lapsada (només cursor) falla a Word per Mac.
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
                    // El cursor ha de quedar DESPRÉS de la cita, FORA del
                    // content control, per poder continuar escrivint sense
                    // que el text entri dins la cita. RangeLocation.After és
                    // el punt degenerat just després del CC.
                    cc.getRange(Word.RangeLocation.after).select();
                    await context.sync();
                } catch (ccErr) {
                    // El text JA és al document; només falla el seguiment per
                    // Content Control. Igualment, situa el cursor al final.
                    try {
                        inserted.getRange(Word.RangeLocation.after).select();
                        await context.sync();
                    } catch (selErr) { /* no-op */ }
                    console.warn('CC wrap failed (text inserit igualment):', ccErr && ccErr.message);
                }
            });
            // Recalcula totes les cites amb context complet (com
            // Mendeley/Zotero): APA aplica 2020a/2020b, `et al.` i
            // desambiguació de cognoms sol, sense cap acció manual.
            await reformatAllCitations({ silent: true });
            // Retorna el focus del teclat al document. Office.js NO té API
            // per fer-ho a Word d'escriptori (limitació coneguda,
            // office-js#316/#4549), però window.blur() des del taskpane
            // allibera el WebView en força builds i el focus torna al
            // document; on no funcioni és innocu.
            returnFocusToDocument();
            setFooter('Inserida @' + item.citation_key + '.');
        } catch (err) {
            console.warn('Word.run insert failed, fallback:', err && err.message);
            // Fallback: API genèrica d'Office (text pla a la selecció).
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
        // Itera tots els Content Controls i extrau els que tinguin el tag
        // `gnosi-cite:<key>`.
        //
        // `uniqueOnly=true` (default) → per a bibliografia (cada key apareix
        //   una sola vegada, sense importar quantes vegades es cita)
        // `uniqueOnly=false` → per a reformat batch (preserva l'ordre
        //   complet incloent duplicats; necessari perquè pandoc-citeproc
        //   pugui fer "et al." i desambiguació autor-any en funció de la
        //   primera vs successives aparicions)
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
        // Per a la bibliografia (llista final del document) cada key
        // apareix una sola vegada — `uniqueOnly=true` (default).
        setFooter('Llegint cites del document…');
        const keys = await collectCitationKeysFromDocument();
        if (!keys.length) {
            setFooter('No s\'han trobat cites al document.');
            return [];
        }
        setFooter('Formatant ' + keys.length + ' entrades…');
        return await formatBibliography(keys);
    }

    async function insertBibliography() {
        const { entries, entriesHtml } = await refreshBibliography();
        if (!entries.length && !entriesHtml.length) return;
        const count = entriesHtml.length || entries.length;
        try {
            await Word.run(async (context) => {
                const body = context.document.body;
                body.insertParagraph('', Word.InsertLocation.end);
                const heading = body.insertParagraph('Bibliografia', Word.InsertLocation.end);
                heading.styleBuiltIn = Word.BuiltInStyleName.heading1;
                if (entriesHtml.length) {
                    // Word converteix <em>/<i> en cursiva i <a href> en
                    // hipervincle real. El format de paràgraf (alineació +
                    // sagnia francesa) s'aplica DESPRÉS via Word.js, no per
                    // CSS: el WebView de Word ignora text-align/marges de
                    // l'HTML i, si no, hereta la justificació de l'estil del
                    // document (espais enormes entre paraules — no és APA).
                    const html = entriesHtml.map((e) => '<p>' + e + '</p>').join('');
                    const range = body.insertHtml(html, Word.InsertLocation.end);
                    range.load('paragraphs');
                    await context.sync();
                    range.paragraphs.items.forEach((p) => {
                        p.alignment = Word.Alignment.left;   // ragged right (no justificat)
                        p.leftIndent = 36;                   // 0,5" — base de la sagnia
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
            setFooter('Bibliografia inserida amb ' + count + ' entrades.');
        } catch (err) {
            setFooter('Error inserint bibliografia: ' + (err && err.message));
        }
    }

    async function reformatAllCitations(opts) {
        // Reformata TOTES les cites del document amb context complet en una
        // sola crida pandoc-citeproc (en ordre, amb duplicats): APA pot
        // decidir 2020a/2020b per mateix autor+any, inicials per a cognoms
        // homònims i `et al.` segons primera vs següents aparicions. Es crida
        // automàticament després de cada inserció (com Mendeley/Zotero), de
        // manera que l'usuari no ha de prémer cap botó. `silent` evita
        // sobreescriure el missatge de peu en el flux automàtic.
        const silent = !!(opts && opts.silent);
        if (typeof Word === 'undefined' || !Word.run) return;
        try {
            await Word.run(async (context) => {
                const ccs = context.document.contentControls;
                ccs.load('items/tag');
                await context.sync();
                const targets = [];  // [{cc, key}] en ordre del document
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
                // Mapeig per ordinal — preserva duplicats i ordre del document.
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

    function bindUI() {
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

        // En canviar l'estil (APA → Chicago…), reformata les cites ja
        // inserides perquè el canvi es propagui sense acció manual.
        const styleSelect = $('style-select');
        if (styleSelect) styleSelect.addEventListener('change', () => {
            reformatAllCitations({ silent: false });
        });
    }

    // Office.onReady garanteix que la API està disponible. També es
    // dispara fora de Word (per testing al navegador) — en aquest cas
    // info.host serà null i les operacions Word.run fallaran amb un
    // error informatiu (s'ha de fer servir el fallback setSelectedDataAsync).
    Office.onReady((info) => {
        setFooter('Host: ' + (info && info.host ? info.host : 'browser'));
        bindUI();
        ping();
        // Càrrega inicial sense filtre — primers 50 per popularitat.
        searchCitations('').then((items) => {
            lastResults = items;
            activeIdx = 0;
            renderResults(items);
        });
    });
})();
