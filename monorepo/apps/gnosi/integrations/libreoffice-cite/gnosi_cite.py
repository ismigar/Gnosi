# -*- coding: utf-8 -*-
"""Gnosi Cite — Extensió LibreOffice Writer (estil Mendeley Cite).

Aquesta és la part client de l'extensió: un *protocol handler* UNO que
registra el protocol ``gnosicite:`` i atén quatre comandes despatxades des
del menú "Gnosi Cite":

    gnosicite:insertCitation      → obre el diàleg de cerca/inserció
    gnosicite:insertBibliography  → recopila les cites i insereix la llista
    gnosicite:refreshAll          → reformata totes les cites (context APA)
    gnosicite:settings            → configura l'URL del backend

Reutilitza els mateixos endpoints que el Word Add-in "Gnosi Cite":

    GET  /api/health
    GET  /api/vault/search-citations?q=&limit=
    GET  /api/vault/format-citation?key=&style=&locale=
    POST /api/vault/format-citations     {keys[], style, locale}
    POST /api/vault/format-bibliography  {keys[], style, locale}

Tracking de cites (equivalent als Content Controls de Word):
    Cada cita inserida s'embolcalla en un *reference mark* de Writer amb el
    nom ``gnosicite::<citation_key>::<uuid>``. Això permet:
      1. Detectar totes les cites del document
      2. Reformatar-les amb context complet (desambiguació APA, et al.)
      3. Generar la bibliografia a partir de les claus

Restriccions tècniques (LibreOffice):
    - El Python embegut de LO NO porta ``requests`` → fem servir només
      ``urllib`` de la stdlib.
    - Les operacions ordenades (refreshAll) recorren el cos del document
      via enumeració de *text portions*; no cobreixen capçaleres, peus de
      pàgina ni cel·les de taula (limitació coneguda v0.1).
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
# Constants i configuració persistent
# ---------------------------------------------------------------------------

IMPL_NAME = "com.gnosi.cite.ProtocolHandler"
SERVICE_NAME = "com.sun.star.frame.ProtocolHandler"

MARK_PREFIX = "gnosicite::"

STYLE_LABELS = ["APA 7", "Chicago (autor-data)", "MLA", "IEEE"]
STYLE_VALUES = ["apa", "chicago-author-date", "modern-language-association", "ieee"]

LOCALE_LABELS = ["Català", "Castellà", "Anglès (US)", "Anglès (UK)"]
LOCALE_VALUES = ["ca-AD", "es-ES", "en-US", "en-GB"]

DEFAULTS = {
    "backend_url": "http://localhost:5002",
    "style": "apa",
    "locale": "ca-AD",
}


def _config_path():
    """Retorna la ruta del fitxer de configuració de l'usuari."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(
        os.path.expanduser("~"), ".config"
    )
    return os.path.join(base, "gnosi-cite", "config.json")


def load_config():
    """Carrega la configuració, omplint amb valors per defecte."""
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
    """Desa la configuració (silenciós si falla)."""
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
    """Embolcall prim sobre els endpoints de cites del backend de Gnosi."""

    def __init__(self, base_url):
        self.base = (base_url or DEFAULTS["backend_url"]).rstrip("/")

    def _get(self, path, params=None, timeout=10):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post(self, path, payload, timeout=30):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
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
# Operacions sobre el document (equivalent a Word.run del add-in)
# ---------------------------------------------------------------------------

class DocOps(object):
    """Inserció i reformatació de cites en un document de Writer."""

    def __init__(self, doc):
        self.doc = doc

    # -- helpers de noms de marca --------------------------------------

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
        # La clau és tot menys l'últim segment (l'uuid); admet claus amb "::".
        return "::".join(parts[:-1]) or None

    # -- inserció -------------------------------------------------------

    def insert_citation(self, key, formatted):
        """Insereix una cita formatada i l'embolcalla en un reference mark."""
        controller = self.doc.getCurrentController()
        view_cursor = controller.getViewCursor()
        text = view_cursor.getText()
        cur = text.createTextCursorByRange(view_cursor)
        cur.setString(formatted)
        mark = self.doc.createInstance("com.sun.star.text.ReferenceMark")
        mark.Name = self._make_name(key)
        text.insertTextContent(cur, mark, True)

    # -- recol·lecció de claus -----------------------------------------

    def unique_keys(self):
        """Claus úniques presents al document (per a la bibliografia)."""
        seen = set()
        ordered = []
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
        """Llista de (nom_marca, clau) en ordre del document, amb duplicats.

        Recorre el cos del document enumerant *text portions*; necessari per
        a la conformitat APA (desambiguació segons primera vs successives
        aparicions). No cobreix capçaleres/peus ni cel·les de taula.
        """
        pairs = []
        try:
            para_enum = self.doc.getText().createEnumeration()
            while para_enum.hasMoreElements():
                para = para_enum.nextElement()
                if not para.supportsService("com.sun.star.text.Paragraph"):
                    continue
                portion_enum = para.createEnumeration()
                while portion_enum.hasMoreElements():
                    portion = portion_enum.nextElement()
                    try:
                        if portion.TextPortionType != "ReferenceMark":
                            continue
                        # Només el portion d'inici per no comptar dos cops els
                        # marks que abasten un rang (inici + final).
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
        except Exception:
            pass
        return pairs

    # -- reformatació en lot (APA) -------------------------------------

    def refresh_all(self, api, style, locale):
        """Reformata totes les cites del document amb context complet.

        Returns:
            (n_actualitzades, error_str_o_None)
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
        """Recopila claus úniques i insereix la bibliografia al final.

        Returns:
            nombre d'entrades inserides (0 si no hi ha cites).
        """
        keys = self.unique_keys()
        if not keys:
            return 0
        resp = api.format_bibliography(keys, style, locale)
        entries = resp.get("entries", []) if isinstance(resp, dict) else []
        if not entries:
            return 0
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
        return len(entries)


# ---------------------------------------------------------------------------
# Diàleg de cerca/inserció (UI programàtica)
# ---------------------------------------------------------------------------

class CiteDialog(unohelper.Base, XActionListener, XTextListener):
    """Sidebar-style picker: cerca, selecció d'estil/idioma i accions."""

    def __init__(self, ctx, api, ops, cfg):
        self.ctx = ctx
        self.smgr = ctx.getServiceManager()
        self.api = api
        self.ops = ops
        self.cfg = cfg
        self.results = []
        self._last_q = None
        self._build()

    # -- construcció ----------------------------------------------------

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
                  {"PositionX": 36, "PositionY": 146, "Width": 84, "Height": 13,
                   "Dropdown": True, "StringItemList": tuple(STYLE_LABELS)})
        self._add("FixedText", "lblLocale",
                  {"PositionX": 128, "PositionY": 148, "Width": 30, "Height": 10,
                   "Label": "Idioma:"})
        self._add("ListBox", "lstLocale",
                  {"PositionX": 162, "PositionY": 146, "Width": 92, "Height": 13,
                   "Dropdown": True, "StringItemList": tuple(LOCALE_LABELS)})

        self._add("Button", "btnInsert",
                  {"PositionX": 6, "PositionY": 166, "Width": 80, "Height": 14,
                   "Label": "Insereix cita"})
        self._add("Button", "btnBib",
                  {"PositionX": 90, "PositionY": 166, "Width": 84, "Height": 14,
                   "Label": "Insereix bibliografia"})
        self._add("Button", "btnRefresh",
                  {"PositionX": 178, "PositionY": 166, "Width": 76, "Height": 14,
                   "Label": "Actualitza tot (APA)"})

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
        self.lstLocale = self.dialog.getControl("lstLocale")
        self.btnInsert = self.dialog.getControl("btnInsert")
        self.btnBib = self.dialog.getControl("btnBib")
        self.btnRefresh = self.dialog.getControl("btnRefresh")
        self.btnSettings = self.dialog.getControl("btnSettings")
        self.btnClose = self.dialog.getControl("btnClose")
        self.lblStatus = self.dialog.getControl("lblStatus")

        # Selecció inicial d'estil/idioma segons la configuració.
        self._select(self.lstStyle, STYLE_VALUES, self.cfg.get("style"))
        self._select(self.lstLocale, LOCALE_VALUES, self.cfg.get("locale"))

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
            (self.btnRefresh, "refresh"),
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

    # -- cicle de vida --------------------------------------------------

    def show(self):
        # Càrrega inicial (sense filtre).
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

    # -- selecció actual ------------------------------------------------

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
        locale = self._current(self.lstLocale, LOCALE_VALUES, "ca-AD")
        self.cfg["style"] = style
        self.cfg["locale"] = locale
        save_config(self.cfg)
        return style, locale

    # -- cerca ----------------------------------------------------------

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
            self._status(
                "Inserida @%s — recorda «Actualitza tot (APA)» abans de publicar." % key
            )
        except Exception as exc:
            self._status("Error inserint: %s" % exc)

    def _insert_bibliography(self):
        style, locale = self._persist()
        try:
            n = self.ops.insert_bibliography(self.api, style, locale)
        except urllib.error.URLError:
            self._status("Sense connexió amb Gnosi (%s)." % self.api.base)
            return
        except Exception as exc:
            self._status("Error: %s" % exc)
            return
        if n:
            self._status("Bibliografia inserida amb %d entrades." % n)
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
        cmd = event.ActionCommand or "pick"  # ListBox doble-clic → buit
        if cmd in ("insert", "pick"):
            self._insert_selected()
        elif cmd == "bib":
            self._insert_bibliography()
        elif cmd == "refresh":
            self._refresh_all()
        elif cmd == "settings":
            SettingsDialog(self.ctx, self.cfg).show()
            self.api = GnosiApi(self.cfg.get("backend_url"))
            self._last_q = None
            self._do_search()
        elif cmd == "close":
            self.dialog.endExecute()

    # -- XEventListener -------------------------------------------------

    def disposing(self, _event):
        pass


# ---------------------------------------------------------------------------
# Diàleg de configuració
# ---------------------------------------------------------------------------

class SettingsDialog(unohelper.Base, XActionListener):
    """Permet editar l'URL del backend de Gnosi."""

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
# Protocol handler (punt d'entrada de les comandes del menú)
# ---------------------------------------------------------------------------

class GnosiCiteHandler(unohelper.Base, XServiceInfo, XDispatchProvider,
                       XDispatch, XInitialization):
    """Atén el protocol ``gnosicite:`` des del menú "Gnosi Cite"."""

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
        api = GnosiApi(cfg["backend_url"])
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
                n = ops.insert_bibliography(api, cfg["style"], cfg["locale"])
                self._msg(
                    "Bibliografia inserida amb %d entrades." % n if n
                    else "No s'han trobat cites al document."
                )
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
# Registre del component (passive registration via pyuno)
# ---------------------------------------------------------------------------

g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(
    GnosiCiteHandler,
    IMPL_NAME,
    (SERVICE_NAME,),
)
