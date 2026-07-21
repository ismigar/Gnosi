# -*- coding: utf-8 -*-
"""Gnosi Cite — LibreOffice Writer extension (Mendeley Cite style).

This is the client side of the extension: a UNO *protocol handler* that
registers the ``gnosicite:`` protocol and handles four commands dispatched from
the "Gnosi Cite" menu:

    gnosicite:insertCitation      → opens the search/insert dialog
    gnosicite:insertBibliography  → collects the citations and inserts the list
    gnosicite:refreshAll          → reformats all citations (APA context)
    gnosicite:settings            → configures the backend URL

Reuses the same endpoints as the "Gnosi Cite" Word Add-in:

    GET  /api/health
    GET  /api/vault/search-citations?q=&limit=
    GET  /api/vault/format-citation?key=&style=&locale=
    POST /api/vault/format-citations     {keys[], style, locale}
    POST /api/vault/format-bibliography  {keys[], style, locale}

Citation tracking (equivalent to Word's Content Controls):
    Each inserted citation is wrapped in a Writer *reference mark* named
    ``gnosicite::<citation_key>::<uuid>``. This allows:
      1. Detecting all citations in the document
      2. Reformatting them with full context (APA disambiguation, et al.)
      3. Generating the bibliography from the keys

Technical constraints (LibreOffice):
    - LO's embedded Python does NOT ship ``requests`` → we only use
      stdlib ``urllib``.
    - Ordered operations (refreshAll) traverse the document body
      via *text portions* enumeration; they do not cover headers, footers,
      or table cells (known limitation v0.1).
"""

import json
import os
import uuid
import urllib.request
import urllib.parse
import urllib.error

import uno
import unohelper

from com.sun.star.frame import XDispatchProvider, XDispatch
from com.sun.star.lang import XServiceInfo, XInitialization
from com.sun.star.awt import XActionListener, XTextListener
from com.sun.star.text.ControlCharacter import PARAGRAPH_BREAK


# ---------------------------------------------------------------------------
# Constants and persistent configuration
# ---------------------------------------------------------------------------

IMPL_NAME = "com.gnosi.cite.ProtocolHandler"
SERVICE_NAME = "com.sun.star.frame.ProtocolHandler"

MARK_PREFIX = "gnosicite::"

# How deep to follow tables inside tables when walking the document for
# citations. Real documents nest one or two levels at most; the bound just
# stops a malformed file from recursing forever.
MAX_TABLE_NESTING = 8

STYLE_LABELS = ["APA 7", "Chicago (autor-data)", "MLA", "IEEE"]
STYLE_VALUES = ["apa", "chicago-author-date", "modern-language-association", "ieee"]

# Fixed locale (not exposed in the UI; parity with the Word Add-in). Kept
# as a constant because the backend endpoints expect it and the config
# saves it, but the dialog no longer shows any selector for it.
DEFAULT_LOCALE = "ca-AD"

DEFAULTS = {
    "backend_url": "http://localhost:5002",
    "api_token": "",
    "style": "apa",
    "locale": DEFAULT_LOCALE,
}


def _config_path():
    """Returns the path to the user's configuration file."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
        os.path.expanduser("~"), ".config"
    )
    return os.path.join(base, "gnosi-cite", "config.json")


def load_config():
    """Loads the configuration, filling in default values."""
    cfg = dict(DEFAULTS)
    try:
        with open(_config_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            for k in DEFAULTS:
                if k in data and data[k]:
                    cfg[k] = data[k]
    except Exception:
        pass
    if not cfg.get("backend_url"):
        cfg["backend_url"] = DEFAULTS["backend_url"]
    return cfg


def save_config(cfg):
    """Saves the configuration (silent on failure)."""
    try:
        path = _config_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Client HTTP (stdlib only)
# ---------------------------------------------------------------------------

class GnosiApi(object):
    """Thin wrapper around the Gnosi backend's citation endpoints."""

    def __init__(self, base_url, api_token=None):
        self.base = (base_url or DEFAULTS["backend_url"]).rstrip("/")
        # Personal Access Token. Unauthenticated calls only work while the
        # backend still falls back to the legacy account; once
        # GNOSI_REQUIRE_AUTH is on they get a 401. Empty means "send nothing",
        # so an existing install keeps working untouched.
        self.token = (api_token or os.environ.get("GNOSI_API_TOKEN") or "").strip()

    def _headers(self, extra=None):
        h = {"Accept": "application/json"}
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        if extra:
            h.update(extra)
        return h

    def _get(self, path, params=None, timeout=10):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=self._headers())
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post(self, path, payload, timeout=30):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base + path,
            data=data,
            headers=self._headers({"Content-Type": "application/json"}),
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def ping(self):
        try:
            self._get("/api/health", timeout=5)
            return True
        except Exception:
            return False

    def search(self, query):
        data = self._get(
            "/api/vault/search-citations",
            {"q": query or "", "limit": 50},
        )
        return data if isinstance(data, list) else []

    def format_citation(self, key, style, locale):
        return self._get(
            "/api/vault/format-citation",
            {"key": key, "style": style, "locale": locale},
        )

    def format_citations(self, keys, style, locale):
        return self._post(
            "/api/vault/format-citations",
            {"keys": keys, "style": style, "locale": locale},
        )

    def format_bibliography(self, keys, style, locale):
        return self._post(
            "/api/vault/format-bibliography",
            {"keys": keys, "style": style, "locale": locale},
        )


# ---------------------------------------------------------------------------
# Document operations (equivalent to the add-in's Word.run)
# ---------------------------------------------------------------------------

class DocOps(object):
    """Insertion and reformatting of citations in a Writer document."""

    def __init__(self, doc):
        self.doc = doc

    # -- brand name helpers --------------------------------------

    @staticmethod
    def _make_name(key):
        return "%s%s::%s" % (MARK_PREFIX, key, uuid.uuid4().hex)

    @staticmethod
    def _key_from_name(name):
        if not name or not name.startswith(MARK_PREFIX):
            return None
        rest = name[len(MARK_PREFIX):]
        parts = rest.split("::")
        if len(parts) < 2:
            return None
        # The key is everything except the last segment (the uuid); supports keys containing "::".
        return "::".join(parts[:-1]) or None

    # -- insertion -------------------------------------------------------

    def insert_citation(self, key, formatted):
        """Inserts a formatted citation and wraps it in a reference mark."""
        controller = self.doc.getCurrentController()
        view_cursor = controller.getViewCursor()
        text = view_cursor.getText()
        cur = text.createTextCursorByRange(view_cursor)
        cur.setString(formatted)
        mark = self.doc.createInstance("com.sun.star.text.ReferenceMark")
        mark.Name = self._make_name(key)
        text.insertTextContent(cur, mark, True)
        # Places the cursor AFTER the citation (collapsed at the end of the range
        # the mark occupies) so the user can keep typing without
        # so that the text enters inside the reference mark.
        try:
            end = mark.getAnchor().getEnd()
            view_cursor.gotoRange(end, False)
        except Exception:
            pass

    # -- key collection -----------------------------------------

    def unique_keys(self):
        """Unique keys present in the document, in DOCUMENT order.

        Document order matters: `/format-bibliography` feeds the keys to
        citeproc as `nocite` in the order given, and numeric styles (IEEE)
        assign `citation-number` from it. `getElementNames()` returns the marks
        in container (name) order, which made the bibliography numbering
        disagree with the in-text `[1]`, `[2]` from `refresh_all` (document
        order) — every number pointed at the wrong reference. Falls back to
        container order if the portion enumeration fails (same body-only
        limitation as `refresh_all`).
        """
        seen = set()
        ordered = []
        for _name, key in self._ordered_pairs():
            if key and key not in seen:
                seen.add(key)
                ordered.append(key)
        if ordered:
            return ordered
        try:
            marks = self.doc.getReferenceMarks()
            for name in marks.getElementNames():
                key = self._key_from_name(name)
                if key and key not in seen:
                    seen.add(key)
                    ordered.append(key)
        except Exception:
            pass
        return ordered

    def _ordered_pairs(self):
        """List of (mark_name, key) in document order, with duplicates.

        Traverses the document by enumerating *text portions*; necessary for
        APA compliance (disambiguation depends on first vs. subsequent
        occurrences, so the order has to be the reading order).

        Table cells are included: a table sits in the body flow, so the
        citations inside it have a well-defined position in that order.
        Headers and footers are deliberately left out — they repeat on every
        page, so there is no single position in the reading order to
        disambiguate them against. They still reach the bibliography, which
        only needs the set of keys (see `ordered_keys`).

        Returns:
            A list of (mark_name, citation_key) tuples in document order,
            duplicates included.
        """
        return self._pairs_in_text(self.doc.getText())

    def _pairs_in_text(self, text, depth=0):
        """Collect (mark_name, key) pairs from one text container, in order.

        Args:
            text: An XText to enumerate — the document body, or a table cell.
            depth: Current table nesting level, to bound recursion on
                pathological documents.

        Returns:
            A list of (mark_name, citation_key) tuples in traversal order.
        """
        pairs = []
        if text is None or depth > MAX_TABLE_NESTING:
            return pairs
        try:
            para_enum = text.createEnumeration()
        except Exception:
            return pairs
        while True:
            try:
                if not para_enum.hasMoreElements():
                    break
                para = para_enum.nextElement()
                # A table is yielded by the body enumeration just like a
                # paragraph; descending here is what keeps its citations at
                # the right point of the document order instead of dropping
                # them (they used to be skipped by the Paragraph check below).
                if para.supportsService("com.sun.star.text.TextTable"):
                    pairs.extend(self._pairs_in_table(para, depth))
                    continue
                if not para.supportsService("com.sun.star.text.Paragraph"):
                    continue
                portion_enum = para.createEnumeration()
            except Exception:
                # One malformed element must not abort the whole traversal:
                # a partial reformat is better than none.
                continue
            while True:
                try:
                    if not portion_enum.hasMoreElements():
                        break
                    portion = portion_enum.nextElement()
                except Exception:
                    break
                try:
                    if portion.TextPortionType != "ReferenceMark":
                        continue
                    # Only the start portion, to avoid double-counting the
                    # marks that span a range (start + end).
                    if not getattr(portion, "IsStart", True):
                        continue
                    mark = getattr(portion, "ReferenceMark", None)
                    if mark is None:
                        continue
                    name = mark.Name
                except Exception:
                    continue
                key = self._key_from_name(name)
                if key:
                    pairs.append((name, key))
        return pairs

    def _pairs_in_table(self, table, depth):
        """Collect pairs from every cell of a table, in cell order.

        `getCellNames()` returns cells row-major (A1, B1, A2…), which is the
        reading order for the regular tables this add-in targets. Merged or
        nested layouts fall back to whatever order the table reports; that is
        still stable, which is what disambiguation needs.

        Args:
            table: A com.sun.star.text.TextTable from the body enumeration.
            depth: Nesting level of this table.

        Returns:
            A list of (mark_name, citation_key) tuples.
        """
        pairs = []
        try:
            cell_names = list(table.getCellNames())
        except Exception:
            return pairs
        for cell_name in cell_names:
            try:
                cell = table.getCellByName(cell_name)
            except Exception:
                continue
            pairs.extend(self._pairs_in_text(cell, depth + 1))
        return pairs

    # -- batch reformatting (APA) -------------------------------------

    def refresh_all(self, api, style, locale):
        """Reformats all citations in the document with full context.

        Returns:
            (n_updated, error_str_or_None)
        
        """
        pairs = self._ordered_pairs()
        if not pairs:
            return 0, "no-cites"
        keys = [k for (_, k) in pairs]
        resp = api.format_citations(keys, style, locale)
        items = resp.get("items", []) if isinstance(resp, dict) else []
        if not items:
            return 0, "no-format"
        marks = self.doc.getReferenceMarks()
        updated = 0
        for idx, (name, _key) in enumerate(pairs):
            if idx >= len(items):
                break
            formatted = items[idx].get("formatted") if isinstance(items[idx], dict) else None
            if not formatted:
                continue
            try:
                if not marks.hasByName(name):
                    continue
                anchor = marks.getByName(name).getAnchor()
                anchor.setString(formatted)
                updated += 1
            except Exception:
                continue
        return updated, None

    # -- bibliografia ---------------------------------------------------

    def insert_bibliography(self, api, style, locale):
        """Collects unique keys and inserts the bibliography at the end.

        Returns:
            (n_entries_inserted, missing_keys) — 0 entries if there are no
            citations; `missing_keys` are keys the backend didn't resolve.

        """
        keys = self.unique_keys()
        if not keys:
            return 0, []
        resp = api.format_bibliography(keys, style, locale)
        entries = resp.get("entries", []) if isinstance(resp, dict) else []
        # Keys the backend could not resolve (deleted record, renamed Citation
        # Key): the entry is simply absent from `entries`, so without surfacing
        # this the user gets a silently incomplete bibliography.
        missing = resp.get("missing", []) if isinstance(resp, dict) else []
        if not entries:
            return 0, missing
        text = self.doc.getText()
        cur = text.createTextCursorByRange(text.getEnd())
        text.insertControlCharacter(cur, PARAGRAPH_BREAK, False)
        try:
            cur.ParaStyleName = "Heading 1"
        except Exception:
            pass
        text.insertString(cur, "Bibliografia", False)
        text.insertControlCharacter(cur, PARAGRAPH_BREAK, False)
        try:
            cur.ParaStyleName = "Standard"
        except Exception:
            pass
        for entry in entries:
            text.insertString(cur, entry, False)
            text.insertControlCharacter(cur, PARAGRAPH_BREAK, False)
        return len(entries), missing


# ---------------------------------------------------------------------------
# Search/insert dialog (programmatic UI)
# ---------------------------------------------------------------------------

class CiteDialog(unohelper.Base, XActionListener, XTextListener):
    """Sidebar-style picker: search, style/language selection, and actions."""

    def __init__(self, ctx, api, ops, cfg):
        self.ctx = ctx
        self.smgr = ctx.getServiceManager()
        self.api = api
        self.ops = ops
        self.cfg = cfg
        self.results = []
        self._last_q = None
        self._build()

    # -- construction ----------------------------------------------------

    def _add(self, service, name, props):
        model = self.dmodel.createInstance(
            "com.sun.star.awt.UnoControl%sModel" % service
        )
        for key, value in props.items():
            setattr(model, key, value)
        model.Name = name
        self.dmodel.insertByName(name, model)

    def _build(self):
        self.dmodel = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.UnoControlDialogModel", self.ctx
        )
        self.dmodel.Width = 260
        self.dmodel.Height = 234
        self.dmodel.Title = "Gnosi Cite"

        self._add("FixedText", "lblSearch",
                  {"PositionX": 6, "PositionY": 6, "Width": 40, "Height": 10,
                   "Label": "Cerca:"})
        self._add("Edit", "txtSearch",
                  {"PositionX": 48, "PositionY": 4, "Width": 206, "Height": 13})
        self._add("ListBox", "lstResults",
                  {"PositionX": 6, "PositionY": 22, "Width": 248, "Height": 120,
                   "Dropdown": False, "MultiSelection": False})

        self._add("FixedText", "lblStyle",
                  {"PositionX": 6, "PositionY": 148, "Width": 28, "Height": 10,
                   "Label": "Estil:"})
        self._add("ListBox", "lstStyle",
                  {"PositionX": 36, "PositionY": 146, "Width": 218, "Height": 13,
                   "Dropdown": True, "StringItemList": tuple(STYLE_LABELS)})

        self._add("Button", "btnInsert",
                  {"PositionX": 6, "PositionY": 166, "Width": 80, "Height": 14,
                   "Label": "Insereix cita"})
        self._add("Button", "btnBib",
                  {"PositionX": 90, "PositionY": 166, "Width": 164, "Height": 14,
                   "Label": "Insereix bibliografia"})

        self._add("FixedText", "lblStatus",
                  {"PositionX": 6, "PositionY": 186, "Width": 248, "Height": 20,
                   "Label": "", "MultiLine": True})

        self._add("Button", "btnSettings",
                  {"PositionX": 6, "PositionY": 212, "Width": 80, "Height": 14,
                   "Label": "Configuració…"})
        self._add("Button", "btnClose",
                  {"PositionX": 178, "PositionY": 212, "Width": 76, "Height": 14,
                   "Label": "Tanca"})

        self.dialog = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.UnoControlDialog", self.ctx
        )
        self.dialog.setModel(self.dmodel)

        self.txtSearch = self.dialog.getControl("txtSearch")
        self.lstResults = self.dialog.getControl("lstResults")
        self.lstStyle = self.dialog.getControl("lstStyle")
        self.btnInsert = self.dialog.getControl("btnInsert")
        self.btnBib = self.dialog.getControl("btnBib")
        self.btnSettings = self.dialog.getControl("btnSettings")
        self.btnClose = self.dialog.getControl("btnClose")
        self.lblStatus = self.dialog.getControl("lblStatus")

        # Initial style selection based on the configuration. The locale is
        # fix (ca-AD): with author-date styles like APA the locale barely
        # doesn't change anything and the selector just added noise (parity with the
        # Word Add-in, which doesn't expose it either).
        self._select(self.lstStyle, STYLE_VALUES, self.cfg.get("style"))

        toolkit = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.Toolkit", self.ctx
        )
        self.dialog.setVisible(False)
        self.dialog.createPeer(toolkit, None)

        # Listeners.
        self.txtSearch.addTextListener(self)
        self.lstResults.addActionListener(self)  # doble-clic → inserir
        for ctrl, cmd in (
            (self.btnInsert, "insert"),
            (self.btnBib, "bib"),
            (self.btnSettings, "settings"),
            (self.btnClose, "close"),
        ):
            ctrl.setActionCommand(cmd)
            ctrl.addActionListener(self)

    @staticmethod
    def _select(ctrl, values, value):
        try:
            idx = values.index(value) if value in values else 0
        except Exception:
            idx = 0
        try:
            ctrl.selectItemPos(idx, True)
        except Exception:
            pass

    # -- lifecycle --------------------------------------------------

    def show(self):
        # Initial load (no filter).
        self._do_search()
        if not self.api.ping():
            self._status("Avís: sense connexió amb Gnosi (%s)." % self.api.base)
        self.dialog.execute()
        self.dialog.dispose()

    def _status(self, text):
        try:
            self.lblStatus.setText(text)
        except Exception:
            pass

    # -- current selection ------------------------------------------------

    def _current(self, ctrl, values, default):
        try:
            pos = ctrl.getSelectedItemPos()
            if 0 <= pos < len(values):
                return values[pos]
        except Exception:
            pass
        return default

    def _persist(self):
        style = self._current(self.lstStyle, STYLE_VALUES, "apa")
        locale = self.cfg.get("locale") or DEFAULT_LOCALE
        self.cfg["style"] = style
        self.cfg["locale"] = locale
        save_config(self.cfg)
        return style, locale

    # -- search ----------------------------------------------------------

    def _do_search(self):
        query = ""
        try:
            query = self.txtSearch.getText()
        except Exception:
            pass
        if query == self._last_q:
            return
        self._last_q = query
        try:
            self.results = self.api.search(query)
        except urllib.error.URLError:
            self.results = []
            self._status("Sense connexió amb Gnosi (%s)." % self.api.base)
            return
        except Exception as exc:
            self.results = []
            self._status("Error de cerca: %s" % exc)
            return

        try:
            count = self.lstResults.getItemCount()
            if count:
                self.lstResults.removeItems(0, count)
        except Exception:
            pass
        labels = []
        for item in self.results:
            key = item.get("citation_key", "")
            title = item.get("title") or "—"
            meta_parts = [p for p in [item.get("author"), self._year(item)] if p]
            meta = ", ".join(meta_parts)
            label = "@%s — %s" % (key, title)
            if meta:
                label += " (%s)" % meta
            labels.append(label)
        if labels:
            try:
                self.lstResults.addItems(tuple(labels), 0)
            except Exception:
                pass
        self._status("%d resultats" % len(self.results))

    @staticmethod
    def _year(item):
        year = item.get("year")
        return str(year) if year else ""

    # -- accions --------------------------------------------------------

    def _insert_selected(self):
        try:
            pos = self.lstResults.getSelectedItemPos()
        except Exception:
            pos = -1
        if pos is None or pos < 0 or pos >= len(self.results):
            self._status("Selecciona una referència de la llista.")
            return
        item = self.results[pos]
        key = item.get("citation_key")
        if not key:
            return
        style, locale = self._persist()
        try:
            data = self.api.format_citation(key, style, locale)
            formatted = (data or {}).get("formatted") or ("(%s)" % key)
        except Exception:
            formatted = "(%s)" % key
        try:
            self.ops.insert_citation(key, formatted)
        except Exception as exc:
            self._status("Error inserint: %s" % exc)
            return
        # Recalculates all citations with full context (like Mendeley/Zotero):
        # APA applies 2020a/2020b, "et al.", and surname disambiguation without
        # manual action. If the refresh fails, the inserted citation is kept.
        try:
            n, err = self.ops.refresh_all(self.api, style, locale)
            if err:
                self._status("Inserida @%s." % key)
            else:
                self._status("Inserida @%s — %d cites actualitzades (APA)." % (key, n))
        except urllib.error.URLError:
            self._status("Inserida @%s." % key)

    def _insert_bibliography(self):
        style, locale = self._persist()
        try:
            n, missing = self.ops.insert_bibliography(self.api, style, locale)
        except urllib.error.URLError:
            self._status("Sense connexió amb Gnosi (%s)." % self.api.base)
            return
        except Exception as exc:
            self._status("Error: %s" % exc)
            return
        if n and missing:
            self._status(
                "Bibliografia inserida amb %d entrades. Sense resoldre: %s"
                % (n, ", ".join(missing))
            )
        elif n:
            self._status("Bibliografia inserida amb %d entrades." % n)
        elif missing:
            self._status("Cap cita resolta. Sense resoldre: %s" % ", ".join(missing))
        else:
            self._status("No s'han trobat cites al document.")

    def _refresh_all(self):
        style, locale = self._persist()
        try:
            n, err = self.ops.refresh_all(self.api, style, locale)
        except urllib.error.URLError:
            self._status("Sense connexió amb Gnosi (%s)." % self.api.base)
            return
        except Exception as exc:
            self._status("Error: %s" % exc)
            return
        if err == "no-cites":
            self._status("No s'han trobat cites al document.")
        elif err:
            self._status("No s'ha pogut reformatar.")
        else:
            self._status("Cites reformatades amb context APA: %d." % n)

    # -- XTextListener --------------------------------------------------

    def textChanged(self, _event):
        self._do_search()

    # -- XActionListener ------------------------------------------------

    def actionPerformed(self, event):
        cmd = event.ActionCommand or "pick"  # ListBox double-click → empty
        if cmd in ("insert", "pick"):
            self._insert_selected()
        elif cmd == "bib":
            self._insert_bibliography()
        elif cmd == "refresh":
            self._refresh_all()
        elif cmd == "settings":
            SettingsDialog(self.ctx, self.cfg).show()
            self.api = GnosiApi(self.cfg.get("backend_url"), self.cfg.get("api_token"))
            self._last_q = None
            self._do_search()
        elif cmd == "close":
            self.dialog.endExecute()

    # -- XEventListener -------------------------------------------------

    def disposing(self, _event):
        pass


# ---------------------------------------------------------------------------
# Settings dialog
# ---------------------------------------------------------------------------

class SettingsDialog(unohelper.Base, XActionListener):
    """Allows editing the Gnosi backend URL."""

    def __init__(self, ctx, cfg):
        self.ctx = ctx
        self.smgr = ctx.getServiceManager()
        self.cfg = cfg
        self._build()

    def _add(self, service, name, props):
        model = self.dmodel.createInstance(
            "com.sun.star.awt.UnoControl%sModel" % service
        )
        for key, value in props.items():
            setattr(model, key, value)
        model.Name = name
        self.dmodel.insertByName(name, model)

    def _build(self):
        self.dmodel = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.UnoControlDialogModel", self.ctx
        )
        self.dmodel.Width = 240
        self.dmodel.Height = 80
        self.dmodel.Title = "Gnosi Cite — Configuració"

        self._add("FixedText", "lbl",
                  {"PositionX": 6, "PositionY": 6, "Width": 228, "Height": 10,
                   "Label": "URL del backend de Gnosi:"})
        self._add("Edit", "txtUrl",
                  {"PositionX": 6, "PositionY": 18, "Width": 228, "Height": 13,
                   "Text": self.cfg.get("backend_url", DEFAULTS["backend_url"])})
        self._add("FixedText", "hint",
                  {"PositionX": 6, "PositionY": 34, "Width": 228, "Height": 18,
                   "Label": "Ex.: http://localhost:5002 o https://gnosi.exemple.com",
                   "MultiLine": True})
        self._add("Button", "btnOk",
                  {"PositionX": 78, "PositionY": 58, "Width": 70, "Height": 14,
                   "Label": "Desa"})
        self._add("Button", "btnCancel",
                  {"PositionX": 154, "PositionY": 58, "Width": 70, "Height": 14,
                   "Label": "Cancel·la"})

        self.dialog = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.UnoControlDialog", self.ctx
        )
        self.dialog.setModel(self.dmodel)
        self.txtUrl = self.dialog.getControl("txtUrl")
        toolkit = self.smgr.createInstanceWithContext(
            "com.sun.star.awt.Toolkit", self.ctx
        )
        self.dialog.setVisible(False)
        self.dialog.createPeer(toolkit, None)
        for name, cmd in (("btnOk", "ok"), ("btnCancel", "cancel")):
            ctrl = self.dialog.getControl(name)
            ctrl.setActionCommand(cmd)
            ctrl.addActionListener(self)

    def show(self):
        self.dialog.execute()
        self.dialog.dispose()

    def actionPerformed(self, event):
        if event.ActionCommand == "ok":
            url = (self.txtUrl.getText() or "").strip()
            if url:
                self.cfg["backend_url"] = url
                save_config(self.cfg)
        self.dialog.endExecute()

    def disposing(self, _event):
        pass


# ---------------------------------------------------------------------------
# Protocol handler (entry point for the menu commands)
# ---------------------------------------------------------------------------

class GnosiCiteHandler(unohelper.Base, XServiceInfo, XDispatchProvider,
                       XDispatch, XInitialization):
    """Handles the ``gnosicite:`` protocol from the "Gnosi Cite" menu."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.smgr = ctx.getServiceManager()
        self.frame = None

    # -- XInitialization ------------------------------------------------

    def initialize(self, args):
        if args:
            self.frame = args[0]

    # -- XDispatchProvider ----------------------------------------------

    def queryDispatch(self, url, _target, _flags):
        if url.Protocol == "gnosicite:":
            return self
        return None

    def queryDispatches(self, requests):
        return tuple(
            self.queryDispatch(r.FeatureURL, r.FrameName, r.SearchFlags)
            for r in requests
        )

    # -- XDispatch ------------------------------------------------------

    def dispatch(self, url, _args):
        cmd = url.Path
        cfg = load_config()
        api = GnosiApi(cfg["backend_url"], cfg.get("api_token"))
        try:
            if cmd == "settings":
                SettingsDialog(self.ctx, cfg).show()
                return

            doc = self._doc()
            if doc is None or not self._is_writer(doc):
                self._msg("Obre un document de Writer primer.")
                return
            ops = DocOps(doc)

            if cmd == "insertCitation":
                CiteDialog(self.ctx, api, ops, cfg).show()
            elif cmd == "insertBibliography":
                n, missing = ops.insert_bibliography(api, cfg["style"], cfg["locale"])
                if n and missing:
                    self._msg(
                        "Bibliografia inserida amb %d entrades.\nSense resoldre: %s"
                        % (n, ", ".join(missing))
                    )
                elif n:
                    self._msg("Bibliografia inserida amb %d entrades." % n)
                elif missing:
                    self._msg(
                        "Cap cita resolta. Sense resoldre: %s" % ", ".join(missing),
                        error=True,
                    )
                else:
                    self._msg("No s'han trobat cites al document.")
            elif cmd == "refreshAll":
                n, err = ops.refresh_all(api, cfg["style"], cfg["locale"])
                if err == "no-cites":
                    self._msg("No s'han trobat cites al document.")
                elif err:
                    self._msg("No s'ha pogut reformatar.")
                else:
                    self._msg("Cites reformatades amb context APA: %d." % n)
        except urllib.error.URLError:
            self._msg(
                "Sense connexió amb Gnosi (%s).\nRevisa l'URL a «Configuració»."
                % cfg.get("backend_url"),
                error=True,
            )
        except Exception as exc:
            self._msg("Error: %s" % exc, error=True)

    def addStatusListener(self, _listener, _url):
        pass

    def removeStatusListener(self, _listener, _url):
        pass

    # -- helpers --------------------------------------------------------

    def _doc(self):
        try:
            if self.frame is not None:
                model = self.frame.getController().getModel()
                if model is not None:
                    return model
        except Exception:
            pass
        try:
            desktop = self.smgr.createInstanceWithContext(
                "com.sun.star.frame.Desktop", self.ctx
            )
            return desktop.getCurrentComponent()
        except Exception:
            return None

    @staticmethod
    def _is_writer(doc):
        try:
            return doc.supportsService("com.sun.star.text.TextDocument")
        except Exception:
            return False

    def _msg(self, text, error=False):
        try:
            from com.sun.star.awt.MessageBoxType import INFOBOX, ERRORBOX
            from com.sun.star.awt.MessageBoxButtons import BUTTONS_OK
            window = self.frame.getContainerWindow()
            toolkit = window.getToolkit()
            box = toolkit.createMessageBox(
                window,
                ERRORBOX if error else INFOBOX,
                BUTTONS_OK,
                "Gnosi Cite",
                text,
            )
            box.execute()
        except Exception:
            pass

    # -- XServiceInfo ---------------------------------------------------

    def getImplementationName(self):
        return IMPL_NAME

    def supportsService(self, name):
        return name == SERVICE_NAME

    def getSupportedServiceNames(self):
        return (SERVICE_NAME,)


# ---------------------------------------------------------------------------
# Component registration (passive registration via pyuno)
# ---------------------------------------------------------------------------

g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(
    GnosiCiteHandler,
    IMPL_NAME,
    (SERVICE_NAME,),
)
