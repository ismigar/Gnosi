---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/server.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - frontend/src/App.jsx
tests:
  - backend/tests/test_app_config_language.py
  - backend/tests/test_host_helper_url.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Plataforma base i hora d' execució

## Reversió

La fundació es reuneix tots els dominis en un procés, resol la configuració i les rutes portàtils, la seva pròpia arrencada i l' aturada, s' aplica al 'termware', i expos el frontal de l' àrea de nivell superior. Ha de romandre usable quan les integració opcionals no són absentes.

## Dorsal de muntatge

`backend/server.py` Es mou la instància ràpidaAPI, gestió de l' excepció, muntatge de lectors estàtics, vida i encaminadors. L' ordre enrutador és explícit perquè el context de l' espai de treball i els prefixos amplis es poden sobreposen. L' ordre generat [Catàleg d' API](../generated/api-catalog.md) registren cada muntatge i ruta estàtica.

L'startup de vida és la que fa aquestes classes de treball:

1. Asert que un desplegament exposat no usa un desenvolupament públic JWT
secret.
2. Inicia el planificador i el manteniment de la confirmació.
3. Torna a col· laborar amb els connectors abans de crear capacitats d' agent.
4. Connecteu clients MCP, descobreix eines i compileu la gràfica per omissió de l' agent.
5. Precàrrega persisteixda índexs de voltaíncronament, després refresca' ls en el
En segon lloc, on permet la política més lliure.
6. Carrega les cau derivades abans que qualsevol estalvi els pugui truncar.
7. Inicia els treballadors IDLE per compte IMAP.

Els errors en l' inici opcional de la IA o d'integració s' han registrat i aïllat. Els errors d' inicialització de seguretat i de les dades base no es converteixen en silenci en comportaments sans.

## Fusió de configuració

`load_params()` Combina l' aplicació YAL amb la configuració actual o activa de la sortida. Els valors del diccionari es fusionaran recursivament. La volta activa `.gnosi/params.yaml` Es converteix en l' objectiu persisteix per a les configuracions de la volta. La resolució del camí s' aplica després als valors de l' entorn de desplegament explícits.

Reforçament de la configuració de l' IA. Un entorn antic credential pot crear un proveïdor una vegada, però una làpida persisteixda evita reaparèixer després de l' eliminació deliberació.

## Àrea de treball per a la interfície

`App.jsx` Espera a l' autenticació "mobitra " abans de seleccionar la compartició pública, iniciar sessió o l' intèrpret d' ordres. Les pàgines fortes s' acarregen. Les pròpies pàgines de l' intèrpret d' ordres globals són navegació i superfícies d' interacció disponibles globalment; rutes de pàgines de ruta del contingut del propi domini. `/s/:token` Es refereix a fora de l' intèrpret d' ordres autenticat pel disseny.

## Invariants

- Port `5002` és el contracte del dorsal; `5173` El contracte per a la Frontal.
- El codi d' aplicació usa l' autoriu `Gnosi/` Arbre.
- Cadenes visibles per Frontals utilitzen tots els catàlegs locals.
- No s' han d' usar les importacions d' execució per la generació de documentació.
- Una volta no disponible es representa explícitament; un camí segur temporal pot
Atura les fallades d' importació però no s' han de presentar com a contingut configurat.
- L' escalfament de la memòria cau derivada no pot retardar la primera resposta útil quan un disc segur
La instantània existeix.

## diagnòstic erroni

Comprova el propietari del procés. `/api/health`, `/api/config`, i `/api/vault/pages` En aquesta ordre. Una resposta correcta de salut amb una petició buida o de volta indica la configuració o el problema més lliure del fitxer en comptes d' un servidor mort. Mireu el [operacions a executarbook](../operations/runbook.md).
