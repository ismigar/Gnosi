"""Cursa del cicle load→modify→save del registre central (vault_db_registry.json).

Els ~20 handlers de `vault_routes` (crear/editar taules, esquemes, vistes,
opcions…) i els 2 de `vault_views_routes` (upsert/delete de vistes per pàgina)
carreguen i desen el fitxer SENCER. Sense un candau que serialitzi el cicle
sencer, dues mutacions concurrents llegien el MATEIX snapshot i l'última
escriptura esclafava l'altra (last-writer-wins) — el mateix patró sistèmic dels
PRs #728/#729/#743 (daily note, comentaris, plugins), però sobre el magatzem
més gros i sense cap protecció.

`registry_mutation()` (un `threading.RLock` compartit) fa atòmic el cicle
sencer. Aquí el fil clau és que el candau és de FIL (RLock), no `asyncio.Lock`:
els mutadors reals corren tant a l'event loop (handlers async, cos síncron sense
`await`) com en fils worker (`asyncio.to_thread`: p. ex. el clon de Notion
`write_table`/`write_view`, o el sanejament intern de `load_registry`). Per això
els tests exerciten FILS de debò.

Plantilla: `test_plugins_state_race.py` del #743. El snapshot es captura ABANS
de la barrera: capturar-lo després deixa que el GIL serialitzi la lectura
darrere el `save` de l'altre fil i el test passaria fins i tot sense candau
(fals negatiu). Verificat en negatiu: comentant el `with registry_mutation()`
de `create_view`, `test_concurrent_create_view_both_survive` falla.
"""
import asyncio
import copy
import threading
import time

import pytest

import backend.api.vault_routes as vr


class _FakeRegistryStore:
    """Simula vault_db_registry.json: `load` amb rendez-vous + `save` que hi escriu.

    Rendez-vous DETERMINISTA (no un sleep amb timing): sense candau, els dos
    `load` concurrents es troben a la barrera i tots dos tornen el MATEIX
    snapshot → l'últim `save` esclafa l'altre. Amb el candau, el segon `load` no
    s'executa fins després del primer `save`: la barrera venç (timeout) i el
    segon cicle ja parteix de l'estat actualitzat.
    """

    def __init__(self):
        self.state = {
            "databases": [],
            "tables": [],
            "views": [],
            "option_catalogs": {},
            "pages": {},
        }
        self.saves = 0
        self._barrier = threading.Barrier(2)

    def load(self):
        # Snapshot ABANS de la barrera (vegeu el docstring del mòdul).
        snap = copy.deepcopy(self.state)
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return snap

    def save(self, data):
        self.state = copy.deepcopy(data)
        self.saves += 1


@pytest.fixture()
def store(monkeypatch):
    st = _FakeRegistryStore()
    # Els handlers referencien `load_registry`/`save_registry` com a globals del
    # mòdul: monkeypatch-ar-los els substitueix a temps de crida. Les versions
    # falses NO toquen el candau, així que l'ÚNIC candau en joc és el que agafa
    # `registry_mutation()` embolcallant el cos del handler.
    monkeypatch.setattr(vr, "load_registry", st.load)
    monkeypatch.setattr(vr, "save_registry", st.save)
    # RLock nou per test perquè no arrossegui estat entre tests.
    monkeypatch.setattr(vr, "_registry_mutation_lock", threading.RLock())
    return st


def _run_async_in_thread(coro_factory):
    """Executa una corutina en un FIL propi (event loop nou). Retorna (thread, box).

    Cal un fil de debò —no `asyncio.gather`— perquè el candau és `threading.RLock`:
    en un sol event loop, dos handlers sense `await` ja corren en sèrie i no
    exercitarien la cursa entre fils que el candau ha de cobrir.
    """
    box: dict = {}

    def runner():
        try:
            box["value"] = asyncio.run(coro_factory())
        except BaseException as exc:  # noqa: BLE001 — el propaguem al test
            box["error"] = exc

    t = threading.Thread(target=runner)
    t.start()
    return t, box


def test_concurrent_create_view_both_survive(store):
    """Dos POST /views simultanis (fils diferents): cap de les dues vistes es perd.

    Sense `registry_mutation()` embolcallant `create_view`, aquest test falla:
    els dos `load` tornen `views: []`, cada fil hi afegeix la seva i l'últim
    `save` esclafa l'altre → només en sobreviu una.
    """
    view_a = {"id": "view-a", "table_id": "t1", "name": "A"}
    view_b = {"id": "view-b", "table_id": "t1", "name": "B"}

    t1, r1 = _run_async_in_thread(lambda: vr.create_view(dict(view_a)))
    t2, r2 = _run_async_in_thread(lambda: vr.create_view(dict(view_b)))
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert "error" not in r1, r1.get("error")
    assert "error" not in r2, r2.get("error")
    ids = {v["id"] for v in store.state["views"]}
    assert ids == {"view-a", "view-b"}, f"s'ha perdut una vista (cursa RMW): {ids}"
    # Dos cicles → dos saves; el candau serialitza, no en fusiona cap.
    assert store.saves == 2


def test_concurrent_create_database_both_survive(store):
    """Dos POST /databases simultanis: cap base de dades es perd."""
    db_a = {"id": "db-a", "name": "A"}
    db_b = {"id": "db-b", "name": "B"}

    t1, r1 = _run_async_in_thread(lambda: vr.create_database(dict(db_a)))
    t2, r2 = _run_async_in_thread(lambda: vr.create_database(dict(db_b)))
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert "error" not in r1, r1.get("error")
    assert "error" not in r2, r2.get("error")
    ids = {d["id"] for d in store.state["databases"]}
    assert ids == {"db-a", "db-b"}, f"s'ha perdut una base de dades: {ids}"


def test_cross_module_lock_is_shared():
    """El candau de `vault_views_routes` és el MATEIX que el de `vault_routes`.

    Un upsert de vista per pàgina (vault_views) i un `create_table` (vault_routes)
    escriuen el mateix fitxer; si cada mòdul tingués el seu propi candau,
    seguirien esclafant-se. Aquí ho comprovem a nivell de primitiva: mentre un
    fil manté `vr.registry_mutation()`, un altre que entra a `vv._registry_mutation()`
    ha de BLOQUEJAR fins que el primer alliberi.

    (No usa la fixture `store`: exercita l'RLock global real, sense tocar disc.)
    """
    from backend.api import vault_views_routes as vv

    events: list[str] = []
    a_holding = threading.Event()
    let_a_go = threading.Event()

    def hold_from_vault_routes():
        with vr.registry_mutation():
            events.append("vr-acquire")
            a_holding.set()
            let_a_go.wait(timeout=1.0)
            events.append("vr-release")

    def try_from_vault_views():
        a_holding.wait(timeout=1.0)
        with vv._registry_mutation():
            events.append("vv-acquire")

    ta = threading.Thread(target=hold_from_vault_routes)
    tb = threading.Thread(target=try_from_vault_views)
    ta.start()
    tb.start()

    assert a_holding.wait(timeout=1.0)
    # Donem temps a B a intentar (i quedar bloquejat): NO ha d'haver adquirit.
    time.sleep(0.1)
    assert "vv-acquire" not in events, "els mòduls NO comparteixen candau (cursa entre mòduls)"

    let_a_go.set()
    ta.join(timeout=2.0)
    tb.join(timeout=2.0)

    assert events == ["vr-acquire", "vr-release", "vv-acquire"], events


def test_sequential_mutations_accumulate(store):
    """Sanejament: dues mutacions SEQÜENCIALS (sense cursa) s'acumulen bé."""

    async def scenario():
        await vr.create_view({"id": "v1", "table_id": "t1", "name": "1"})
        await vr.create_view({"id": "v2", "table_id": "t1", "name": "2"})

    # Sense concurrència, desactivem la barrera perquè no bloquegi el fil únic.
    store._barrier = threading.Barrier(1)
    asyncio.run(scenario())

    ids = {v["id"] for v in store.state["views"]}
    assert ids == {"v1", "v2"}
