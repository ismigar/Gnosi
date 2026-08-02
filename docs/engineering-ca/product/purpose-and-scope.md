---
status: implemented
last_verified: 2026-08-02
source_paths:
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Prima i àmbit

## Objectiu del producte

El Gnosi converteix una carpeta controlada per l' usuari de Markdown en un espai de treball connectat sense fer una base de dades organitzada opaca el propietari del coneixement de l' usuari. Combina la portbilitat de fitxers amb el comportament de les aplicacions d' alt nivell: vistes estructurades, edició, cerca, gràfica, gràfica, referències, comunicació, automatització, publicació i ajuda a l' IA.

L' objectiu principal d'enginyeria és la sobirania de dades amb col·laboració útil i automatització. Els usuaris han de ser capaços d' inspeccionar, recuperar, sincronitzar i recuperar el seu coneixement independentment del Gnosi.

## Dissenya els principis

### Persisteix la primera vegada local

Markdown i YAML són la representació primària del coneixement. Els índexs i la memòria cau han de ser força avançats. Les bases de dades de magatzems de bases de dades que no pertanyen naturalment en una nota, com ara les identitats, les seves identitats, els índexs de missatge i la història d' execució.

### Mode personal sense compte per sobre

El valor per omissió `personal` El mode pot executar- se com una aplicació d' un sol usuari local sense una pantalla d' accés. `org` El mode habilita el comportament d' usuari autenticat, espais de treball, rols i comprovacions d' accés. Els desplegaments sensibles a la seguretat poden forçar l' autenticació fins i tot mentre es conservaran les semàntices del mode personal.

### PortablePista

El codi principal ha d' operar natiument i en Darraker. La detecció de desplegament pot seleccionar els valors apropiats per omissió, però el codi de domini no ha d' assumir noms de màquina de només Docker o rutes absoluts.

### Efectes externs explicants

Obrir fitxers, enviar missatges, publicar continguts, esborrar dades, invocar eines generades i cridant als serveis remots creuant límits de confiança. Aquestes operacions usen serveis localitzats i, a on s' aplica, comprovacions de rol o polítiques de confirmació explícites.

### degradació Graceda

Els proveïdors opcionals i la integració han de fallar localment. Un proveïdor d' IA no existeix, un port de traducció, compte de correu o servei de la hidratació del fitxer en núvol no ha de fer operacions no relacionades amb la volta no disponibles.

## Superfície de producte

- Coneixement: markdown Pages, edició de blocs, adjunts, vistes, cerca, gràfica.
- Referència: referències, citacions CSL, lectura PDF/EPUB, anotacions, fonts.
- Comunicació: mail, calendaris, reunions, contactes.
- Intel·ligència: registre de models, agents, eines MCP, habilitats en temps d' execució, fonts de context.
- Automatització: Tasques planificades, fórmules, flexions, recordatoris, publicació.
- Integració: Google, Microsoft, Noció, Drupal, xarxes socials, oficina afegeix-his.
- Distribució: temps d' execució de web nativa, aplicació d' escriptori electrònica,
I navegador i companys de companys de treball.

## No-goals i límits

- El Gnosi no requereix una base de dades de núvol propietari com a font de veritat.
- Els índexs derivats no són substituts per a la volta.
- La col·laboració en temps real actualment proveeix una base de renom/presència; és
No està documentat com a edició completa del CRDT fins que aquest comportament s' implementa.
- El codi de lector Zotero no és propietat de la lògica de l' aplicació Gnosi. El Gnosi propietari del programa.
El pas, el límit d'integració, els canvis locals i les dades flueix al voltant.
- Una proposta de funcionalitat en una directiva no és enviada al comportament fins que es verifica
Font i proves.

## conseqüència de la llicència

El Gnosi és AGPL- o- altter. Les versions modificades ofertes per una xarxa han de fer que la seva font corresponent estigui disponible sota la mateixa llicència. Els col· laboradors han de mantenir la font, documentació tècnica i instruccions operatives adequades per a la revisió de tercers.
