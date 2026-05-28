# Directiva: Col·laboració entre persones al Vault — proposta arquitectònica

> ID: COLLAB-PROPOSAL-20260528
> Estat: **Proposta** (no implementat).
> Relacionada: `gnosi_native_reference_manager.md`, `environment_integrity.md`.

---

## 1. Per què aquesta directiva existeix

Gnosi és avui un **Vault personal**. El refactor Zotero L1-L3 va consolidar-lo
com a gestor de referències complet per a un sol usuari, però va deixar fora
deliberadament la pregunta: *com comparteixo una biblioteca o un projecte
amb una altra persona?*

Aquesta directiva no implementa col·laboració. La seva missió és:

1. Documentar **per què és més complex del que sembla**.
2. Explorar les **3 vies arquitectòniques** disponibles, amb pros/contres
   honests.
3. Donar una **recomanació** preliminar segons el cas d'ús més probable
   (no totes les vies tenen el mateix sentit).
4. Quedar com a **punt de partida** quan algú decideixi abordar-ho seriosament.

---

## 2. Per què Gnosi NO té col·laboració avui

Característiques de la solució actual que la fan **personal-by-design**:

- **Vault = directori al disc** (típicament dins OneDrive). Sense capa de
  servidor — el frontend parla amb un backend Python local que llegeix/escriu
  fitxers Markdown.
- **Sincronització via filesystem cloud** (OneDrive/Dropbox/iCloud Drive),
  no via la lògica de Gnosi. La cloud fa el sync; Gnosi només llegeix
  el directori.
- **Cap noció d'usuari**: el backend tracta cada petició com el propietari
  del Vault. No hi ha autenticació entre persones.
- **Anotacions, frontmatter, registry, sidecars, índexs**: tots locals al
  Vault de cada usuari.

Aquest disseny és **una virtut, no un bug**: cap server-side state significa
zero cost d'infrastructura, privacy by default, ownership dels propis fitxers.
La col·laboració és el contrari de cada un d'aquests valors — afegir-la
sempre serà un compromís.

---

## 3. Les 3 vies arquitectòniques

### Via A — "Compartir via cloud filesystem amb resolució de conflictes"

**Idea:** dos usuaris apunten el seu Gnosi al mateix directori de cloud
(p.ex. OneDrive compartit). La cloud sync s'encarrega de la propagació.
Gnosi només ha de **detectar i resoldre col·lisions** d'edicions
simultànies sobre el mateix .md.

**Pros:**
- Cost d'infra: **zero**. Cap servidor nou.
- Compatibilitat: el Vault segueix sent un directori plà.
- Privacy: cap dada surt del cloud que els usuaris ja paguen.
- Funcionalment 80% del que Zotero Groups ofereix per als casos més habituals
  (un autor + el seu tutor compartint una biblioteca de revisió).

**Contres:**
- **Edicions simultànies de la mateixa fitxa** = conflicte. OneDrive crea
  fitxers `Foo (Conflicted Copy).md` que cal resoldre manualment.
- **Cap presència en temps real** ("Maria està editant aquesta pàgina").
- **Cap historial col·laboratiu** més enllà del que ofereix la cloud
  (versions de fitxer, no diff per camp).
- **Setup intrusiu**: l'usuari A ha de configurar el seu Gnosi per apuntar
  a un directori del cloud d'un altre usuari. Permissions, etc.

**Cost d'implementació:** **petit-mig** (1-2 setmanes).
Cal afegir detector de col·lisions, UI per resoldre-les, lock optimista
(`expected_etag` ja existeix), warnings clars.

**Quan té sentit:** investigació personal amb un coautor estable; tesis
doctorals amb tutor; equip petit (<5 persones) amb edicions principalment
no-simultànies.

---

### Via B — "Server centralitzat amb autenticació"

**Idea:** muntar un Gnosi server multi-tenant. Cada usuari té credencials,
biblioteques personals + biblioteques compartides per grup. Vault al servidor;
client només UI.

**Pros:**
- Resolució de conflictes a nivell de **camp** (CRDT / OT), no de fitxer.
- Presència en temps real.
- Permissions granulars per grup.
- Mateixa experiència que Zotero / Notion / Obsidian Publish.

**Contres:**
- **Trenca el principi "vault al teu disc"**. Si el server cau, perdes accés
  fins que torni.
- **Privacy**: el server ha de poder llegir el contingut (o complicar amb
  E2E encryption, encara més car).
- **Cost d'infra**: server + DB + backups + monitoring + scaling. Cada
  vegada que Gnosi creix, el cost creix linealment per usuari.
- **Costos legals**: si emmagatzemes dades d'altres usuaris, GDPR aplica
  amb tot el seu pes.
- **Reescriu mig backend**: tots els endpoints assumeixen "vault = fs local".

**Cost d'implementació:** **gran** (3-6 mesos a temps complet). Probablement
amb una capa Yjs / SignalR / similar per al sync de camps en temps real.

**Quan té sentit:** mai per a Gnosi com el conceps avui. Té sentit si decideixes
que vols competir amb Notion/Zotero com a producte, no com a eina personal.
És una decisió de negoci, no només tècnica.

---

### Via C — "Peer-to-peer amb CRDTs"

**Idea:** cap servidor central. Els dispositius de cada usuari (laptop + mòbil +
laptop del coautor) sincronitzen directament via WebRTC o via un signaling
server lleuger. Cada document Markdown és un CRDT (Yjs o Automerge); les
edicions concurrents convergeixen sense conflicte.

**Pros:**
- Zero servidor central; nominalment "free as in freedom".
- Edicions en temps real funcionen bé fins i tot offline (CRDTs es
  sincronitzen quan torna la connexió).
- Privacy by design (les dades viatgen P2P xifrades).

**Contres:**
- **Curva d'aprenentatge brutal**: CRDTs no són trivials. Aplicar-los
  retrocactivament a un sistema basat en fitxers plans és un repensament.
- **El Markdown deixa de ser canònic**: el format real és el binari Yjs;
  el .md és una projecció. Trenques l'ergonomia "obre el fitxer amb qualsevol
  editor de text".
- **Signaling**: encara necessites un punt central perquè els peers es trobin.
  Si és el teu propi, tornes a tenir cost; si és un servei extern, hi ha
  dependència.
- **Reescriure el backend gairebé sencer.**

**Cost d'implementació:** **gegant** (6-12 mesos). Probablement requereix
canviar el motor de l'editor (de BlockNote a un que parli Yjs nativament,
com Tiptap-Yjs o Lexical-Yjs).

**Quan té sentit:** mai per a Gnosi com a producte personal. Té sentit
acadèmicament com a prova de concepte d'edició col·laborativa sense servidors.

---

## 4. Recomanació

**Si el cas d'ús és "tinc un coautor amb qui revisem una biblioteca compartida"**
→ **Via A** (cloud filesystem amb resolució de col·lisions).

Justificació:
- Cost d'implementació proporcional al benefici real (no escala mal a 50
  persones, però resol el 80% dels casos d'ús personals).
- No trenca cap principi arquitectònic actual.
- Pots començar **demà** sense decisions de negoci ni infra nova.

**Si el cas d'ús és "vull que Gnosi sigui una plataforma SaaS com Notion"**
→ **Via B**, però amb consciència que és reescriure mig producte.

**Si el cas d'ús és "vull explorar P2P / CRDTs com a projecte de recerca"**
→ **Via C**, però com a fork experimental, no com a línia principal de Gnosi.

---

## 5. Pre-requisits abans d'implementar Via A

Si decideixes anar amb la Via A, els passos previs (curts, però necessaris):

1. **Detector de col·lisions en escriptura.** Vault ja té `expected_etag`
   al PATCH; cal cobertura total a tots els endpoints d'escriptura
   (`/pages` POST, `/import-references`, `/bulk-update-metadata`,
   `/promote-zotero-extra`, sidecar writes, etc.).

2. **UI de resolució de conflictes.** Modal que mostri:
   - Versió local (la que estàs escrivint).
   - Versió remota (la que un altre ha pujat des d'aquesta sessió).
   - Diff visual per camp del frontmatter; diff per blocs per al body.
   - Opcions: prendre local / prendre remot / fusionar manualment.

3. **Indicador de "no estàs sol al fitxer"** (heartbeat opcional).
   Lleuger: un POST a `/vault/heartbeat/{page_id}` cada N segons; el
   backend retorna llista d'usuaris actius (identificats per
   un fingerprint local, no per autenticació). Si en detecta un altre,
   warning visual al BlockEditor.

4. **Documentació clara** per a l'usuari final: com configurar el cloud
   compartit, què passa si dos editen alhora, com resoldre.

5. **Tests E2E** amb Playwright: simular 2 navegadors editant el mateix
   document i validar que la resolució de conflictes és predictible.

Estimació: **5-8 dies** per a v1 funcional.

---

## 6. Restriccions i casos de cantonada

- **Anotacions PDF**: viuen a SQLite (no .md). Compartir-les via cloud
  filesystem és inviable (binari corromput per locks). Cal una via paral·lela
  (export/import explícit, o moure-les a sidecars JSON).
- **Registry**: és global per Vault. Si dos usuaris afegeixen columnes
  diferents a la mateixa taula, col·lisió segura. Possible mitigació:
  registry per usuari + merge automàtic; o forçar que les columnes
  s'afegeixin via PR-style proposals.
- **Sidecars de metadata** (`.gnosi/page_meta/<id>.json`): igual que el .md,
  cal control de col·lisions.

---

## 7. Cicle d'aprenentatge

| Data | Aprenentatge | Solució |
|---|---|---|
| 2026-05-28 | La pregunta "com afegim col·laboració" no té resposta única; depèn de què entengui l'usuari per "col·laborar". | Document que separa 3 vies amb pros/contres explícits + recomanació. |
