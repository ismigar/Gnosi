# Directiva: Correcció d'Importacions de Base de Dades en Serveis de Background

**Estat:** Staging (En desenvolupament)
**Data:** 2026-04-09
**Relacionat amb:** #SovereignVault #Feeds #Database

## Problema Detectat
Els serveis que s'executen en segon pla (scheduler) o de forma independent, com `feed_ingester.py` i `mail_ingester.py`, fallaven amb un `ImportError` en intentar importar `SessionLocal` des de `backend.data.db`.

Aquest error es deu a que `SessionLocal` ja no és una variable global, ja que ara la base de dades depèn del Vault seleccionat per l'usuari.

## Solució Estàndard
Per obtenir una sessió de base de dades en un servei o script de background, s'ha de seguir aquest protocol:

1. **Importar les utilitats de context i de base de dades:**
   ```python
   from backend.services.context_vars import get_active_vault_path
   from backend.data.db import get_engine_for_path
   ```

2. **Resoldre la sessió dinàmicament:**
   ```python
   v_path = get_active_vault_path()
   _, SessionLocal = get_engine_for_path(v_path)
   db = SessionLocal()
   ```

3. **Fallback:**
   `get_active_vault_path()` té un fallback automàtic que carrega el `params.yaml` per defecte si no s'ha establert cap context de vault (com passa en el scheduler).

## Restriccions i Advertències
- **MAI** importar `SessionLocal` directament de `backend.data.db` com a variable global.
- Assegurar-se que el `PYTHONPATH` inclou l'arrel de l'aplicació quan s'executen scripts manualment.
- Sempre tancar la sessió (`db.close()`) en el bloc `finally`.

## Passos per a la verificació
1. Executar el script manualment: `export PYTHONPATH=$PYTHONPATH:$(pwd)/monorepo/apps/gnosi && python3 path/to/script.py`.
2. Verificar que no hi ha errors d'importació.
3. Comprovar el `scheduler_config.json` per assegurar que l'estat de la tasca és `success`.
