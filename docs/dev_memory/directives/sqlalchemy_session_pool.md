# Gestió de sessions SQLAlchemy i QueuePool al backend

## Objectiu
Evitar l'exhauriment del `QueuePool` del backend FastAPI que es manifestava com:

```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached,
connection timed out, timeout 30.00
```

## Causes detectades

1. **Pool massa petit per ús personal amb concurrència moderada.**
   `create_engine(...)` sense `pool_size`/`max_overflow` usa els defaults
   (5 + 10 = 15 connexions). Amb `Depends(get_workspace_context)` (que ja
   reserva una connexió a `mgmt.db` per a tota la durada de la petició) i
   sessions internes addicionals, 7-15 peticions concurrents són suficients
   per saturar el pool, especialment quan OneDrive fa que cada petició duri
   diversos segons.

2. **Sessions obertes dins `try:` que no es tanquen al `except:`.**
   Patró antipropi:
   ```python
   try:
       session = SessionLocal()
       ... = session.query(...)
       session.close()  # només s'executa al camí feliç
   except Exception:
       ...
   ```
   Si `query` (o qualsevol pas posterior) llança, `session.close()` no
   s'executa i la connexió queda fora del pool indefinidament.

3. **Manca de `pool_pre_ping`/`pool_recycle`.** Després d'un `docker restart`,
   un `sleep` de la màquina o un timeout silenciós del costat del fitxer
   SQLite, les connexions del pool queden mortes; la pròxima `query()` falla
   amb errors d'I/O i no recicla la connexió.

4. **`get_mgmt_db` sense `rollback`.** Si una ruta deixa una transacció
   penjada en error, el `finally: db.close()` retorna una connexió "bruta"
   al pool i la pròxima reutilització hereta l'estat erroni.

## Norma

### Configuració del motor
Tots els `create_engine` del backend han d'incloure:

- `pool_size=20`
- `max_overflow=30`
- `pool_pre_ping=True`
- `pool_recycle=1800` (30 min)

Aplicat a `backend/data/db.py` (motor per-vault) i
`backend/data/management_db.py` (motor `mgmt.db`).

### Patró canònic per a sessions fora de Depends

**Sempre** obrir la sessió **abans** del `try` i tancar-la al `finally`:

```python
session = SessionLocal()
try:
    ... = session.query(...)
    session.commit()
except Exception as e:
    session.rollback()
    ...
finally:
    session.close()
```

### Dependencies de FastAPI
Els generadors d'injecció (`get_db`, `get_mgmt_db`) han d'incloure
`rollback` tant al `except` com al `finally` per garantir que la connexió
torna al pool en estat net.

### Rutes amb `BackgroundTasks`
Les tasques diferides s'executen **després** que el dependency hagi tancat
la sessió. Mai reaprofitar la sessió de la ruta dins d'una background task:
obrir-ne una de nova amb el patró canònic (`open → try/except/rollback →
finally close`). Vegeu `api/contacts_routes.py::background_sync_contact`
com a referència.

## Restriccions / Edge Cases

- **No incrementar pool més enllà de 50** sense revisar primer la freqüència
  d'I/O de OneDrive: connexions inactives consumeixen file descriptors al
  contenidor i a SQLite (que no escala bé amb molts escriptors concurrents).
- **`pool_pre_ping=True` afegeix un `SELECT 1` per cada checkout.** Per a
  SQLite local és insignificant (<1ms); per a engines Postgres remots
  s'hauria de mesurar abans d'activar-ho.
- **No usar `with SessionLocal() as session:`** quan reutilitzem la sessió
  en blocs llargs: el context manager fa commit a la sortida, cosa que
  potser no és el que volem. Preferim el patró explícit.

## Verificació

Després de reiniciar `gnosi_backend`:
```bash
docker exec gnosi_backend python3 -c "
from backend.data.management_db import _get_or_init_mgmt_engine
e, _ = _get_or_init_mgmt_engine()
print('size:', e.pool.size(), 'checkedout:', e.pool.checkedout())
"
```
Després d'una ràfega de 50 GETs paral·lels a `/api/vault/pages`,
`checkedout` ha de tornar a 0 i no han d'aparèixer `QueuePool limit` als
logs.

## Causa-Efecte (memoritzar)

> Pool default (5+10) + dependency que reté connexió + slow OneDrive
> → exhauriment a partir de ~10 peticions paral·leles
> → `TimeoutError: QueuePool limit reached`.
> Solució: pool 20+30 + pre_ping + tancament estricte de sessions
> (try abans, close al finally).
