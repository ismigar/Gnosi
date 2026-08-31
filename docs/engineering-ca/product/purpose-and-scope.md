---
status: implemented
last_verified: 2026-08-02
source_paths:
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Objectiu i abast

## Objectiu del producte

Gnosi converteix una carpeta de Markdown controlada per l'usuari en un espai de
treball connectat, sense deixar el seu coneixement en mans d'una base de dades
allotjada opaca. Combina la portabilitat dels fitxers amb funcions d'aplicació
de nivell superior: vistes estructurades, edició, cerca, recorregut del graf,
referències, comunicació, automatització, publicació i assistència d'IA.

L'objectiu principal d'enginyeria és la sobirania de les dades amb col·laboració
útil i automatització. Els usuaris han de poder inspeccionar, fer còpies de
seguretat, sincronitzar i recuperar el seu coneixement independentment de Gnosi.

## Principis de disseny

### Persistència local-first

Markdown i el frontmatter YAML són la representació principal del coneixement.
Els índexs i les memòries cau acceleren l'accés, però s'han de poder reconstruir.
Les bases de dades relacionals desen l'estat de l'aplicació que no encaixa
naturalment en una nota, com ara identitats, pertinences, índexs de missatges i
historial d'execució.

### Mode personal sense la càrrega de gestionar comptes

El mode predeterminat `personal` pot funcionar com una aplicació local d'un sol
usuari sense pantalla d'inici de sessió. El mode `org` habilita el funcionament
multiusuari autenticat, els espais de treball, els rols i les comprovacions
d'accés. Els desplegaments sensibles a la seguretat poden exigir autenticació
tot mantenint la semàntica del mode personal.

### Desplegament portable

El codi principal ha de funcionar de manera nativa i amb Docker. La detecció
del desplegament pot seleccionar valors predeterminats adequats, però el codi
de domini no ha de pressuposar noms de host exclusius de Docker ni rutes
absolutes exclusives de l'entorn natiu.

### Efectes externs explícits

Obrir fitxers, enviar missatges, publicar contingut, eliminar dades, invocar
eines generades i cridar serveis remots travessa límits de confiança. Aquestes
operacions utilitzen serveis amb un àmbit delimitat i, quan correspon,
comprovacions de rol o polítiques de confirmació explícites.

### Degradació controlada

Les fallades de proveïdors i integracions opcionals han de quedar aïllades.
L'absència d'un proveïdor d'IA, un servei auxiliar de traducció, un compte de
correu o un servei d'hidratació de fitxers del núvol no ha d'impedir les
operacions del vault que no en depenen.

## Àrees del producte

- Coneixement: pàgines Markdown, edició de blocs, adjunts, vistes, cerca i graf.
- Recerca: referències, citacions CSL, lectura PDF/EPUB, anotacions i canals.
- Comunicació: correu, calendaris, reunions i contactes.
- Intel·ligència: registre de models, agents, eines MCP, habilitats d'execució i fonts de context.
- Automatització: tasques programades, fórmules, rollups, recordatoris i publicació.
- Integració: Google, Microsoft, Notion, Drupal, xarxes socials i complements ofimàtics.
- Distribució: execució web nativa, autoallotjament Docker, aplicació d'escriptori
  Electron i clients complementaris de navegador i ofimàtica.

## Objectius exclosos i límits

- Gnosi no requereix una base de dades propietària al núvol com a font de veritat.
- Els índexs derivats no són substituts persistents del vault.
- La col·laboració en temps real ofereix actualment una base de retransmissió
  i presència; no es documenta com a edició CRDT completa fins que s'implementi.
- El codi del lector Zotero inclòs com a dependència no és lògica pròpia de
  Gnosi. Gnosi és responsable de la compilació, el límit d'integració, els
  canvis locals i els fluxos de dades que l'envolten.
- Una proposta de funcionalitat en una directiva no és comportament lliurat
  fins que es verifica al codi i a les proves.

## Conseqüències de la llicència

Gnosi utilitza la llicència AGPL-3.0-or-later. Les versions modificades ofertes
per xarxa han de posar a disposició el codi font corresponent sota la mateixa
llicència. Els col·laboradors han de mantenir el codi, la documentació tècnica
i les instruccions operatives en condicions de ser revisats per tercers.
