# SOP: Solució de ServiceNotFoundException post-actualització

## Context
Quan actualitzem mòduls de Drupal o el propi core, sovint s'introdueixen nous serveis o es canvien els noms dels existents. Si el codi s'executa abans que la memòria cau es netegi completament, Drupal pot intentar carregar un servei que encara no està al contenidor, provocant un error fatal 500.

## Passos a seguir

1. **Reconstrucció de Caché (First priority):**
   - Executar `drush cr`. En entorns remots, utilitzar el `remote_agent.py`.
   - Comanda: `python3 remote_agent_path exec "drush cr"`

2. **Diagnòstic de Servei (Si drush cr no és suficient):**
   - Verificar si el servei està definit al fitxer `*.services.yml` del mòdul afectat.
   - Exemple de servei amb nom de classe (comú en Drupal 10+):
     ```yaml
     Drupal\nom_modul\Servei:
       class: Drupal\nom_modul\Servei
       autowire: true
     ```

3. **Injecció d'Emergència (Hotfix):**
   - Si per algun motiu el servei original ha desaparegut però una dependència el reclama, es pot injectar un servei "Dummy" en un mòdul custom (com `n8n_helper`) per evitar el crash mentre s'investiga.
   - Vegeu referència: `scripts/adhoc/hotfix_token_service.py`.

## Errors Comuns
- **Omissió de Backslashes:** En buscar serveis que usen noms de classe a la CLI (grep), cal escapar les barres: `Drupal\\\\ai\\\\Hook\\\\FormElement`.
