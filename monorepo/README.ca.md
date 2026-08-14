# Gnosi

[English](README.md) · [Català](README.ca.md) · [Español](README.es.md)

**De la font al manuscrit, amb el coneixement sempre teu.**

Gnosi és un espai de recerca local-first i de codi obert. Connecta referències,
evidències de PDF, EPUB i webs, notes Markdown, estructura de projecte, grafs de
coneixement i cites verificables sense convertir un SaaS en el propietari de la
teva feina.

> [!IMPORTANT]
> Gnosi utilitza arxius Markdown i YAML normals com a font de veritat. Les notes
> continuen sent llegibles, portables, versionables i recuperables fora de
> l’aplicació.

## El flux de recerca

1. **Captura o importa** — DOI, ISBN, arXiv, PMID, BibTeX, RIS, pàgines web,
   PDF, EPUB, canals i altres materials de recerca.
2. **Llegeix amb evidències** — conserva anotacions i citacions amb procedència
   de pàgina, paràgraf, capítol, línia o marca temporal.
3. **Connecta i estructura** — transforma les notes de lectura en síntesi humana
   amb wikienllaços, el graf, bases de dades tipades, taulers, calendaris i
   cronologies.
4. **Escriu i cita** — insereix cites actives a Word o LibreOffice i genera
   bibliografies amb CSL/citeproc.

La IA pot ajudar a ingerir, cercar i organitzar fonts amb models locals o al
núvol, però és opcional. Gnosi diferencia les notes de lectura amb evidències de
les notes permanents que expressen les teves conclusions.

## Per què existeix Gnosi

Gnosi va néixer com una resposta personal a un flux fragmentat: Notion aportava
bases de dades i vistes de projecte; Obsidian aportava Markdown i graf;
Mendeley gestionava referències. Calia duplicar les mateixes fonts i idees,
mentre anys de coneixement depenien de productes tancats i polítiques canviants.

Gnosi reuneix aquesta cadena en un sistema obert. Es comparteix com a projecte
comunitari, no com una empresa acabada ni com un substitut universal de totes
les eines.

## Capacitats principals

- Editor de blocs sobre Markdown i YAML portables.
- Bases de dades tipades amb relacions, fórmules, agregacions i vistes desades.
- Graf de coneixement interactiu i suggeriments semàntics opcionals.
- Gestor de referències natiu amb captura compatible amb Zotero i cites CSL.
- Lector PDF/EPUB integrat amb anotacions que preserven l’evidència.
- Complements de citació per a Word i LibreOffice.
- Planificació de recerca amb dependències, recursos, terminis i cronologies.
- Agents multiproveïdor, connectors i eines MCP amb govern explícit.
- Mode personal local-first i mode d’organització autoallotjat opcional.

També hi ha correu, calendari, contactes, canals, traducció i integracions de
publicació, però el recorregut principal és la recerca: font → evidència →
síntesi → citació.

## Prova l’espai de recerca multilingüe

La plantilla oficial signada mostra tot el recorregut en català, castellà i
anglès sense exigir cap proveïdor d’IA ni compte extern.

1. Obre **Configuració → General → Arxius**.
2. A Vaults, tria **Des del repositori**.
3. Selecciona **Research Starter Workspace** i crea el Vault.
4. Obre la nota «Comença aquí».

## Descarrega l’aplicació d’escriptori

Descarrega la versió més recent per a macOS, Windows o Linux a
[GitHub Releases](https://github.com/ismigar/Gnosi/releases/latest). El backend
ja ve inclòs i no cal configurar Python ni Node.

> [!WARNING]
> Les versions d’escriptori encara són beta i no estan signades. A macOS, fes
> clic dret → Obrir la primera vegada. Revisa les notes de la versió abans de
> fer servir Gnosi amb l’única còpia de material important.

## Autoallotjament i contribucions

Les ordres següents són per al desenvolupament i l’autoallotjament. L’execució
nativa és la recomanada; Docker continua sent una opció compatible per a
servidors.

### Requisits

- Python 3.10+
- Node.js i npm
- Opcional: Docker per al desplegament en contenidors
- Opcional: Ollama o un altre proveïdor compatible per a les funcions d’IA

Inicialitza el lector una sola vegada:

```bash
git submodule update --init --recursive
sh apps/gnosi/sh/build-zotero-reader.sh
```

### Execució nativa

```bash
cd apps/gnosi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload
```

En un altre terminal:

```bash
cd apps/gnosi/frontend
npm install
npm run dev
```

Obre `http://localhost:5173`.

### Execució amb Docker (opcional)

```bash
cd apps/gnosi
docker compose up -d --build
```

## Arquitectura i documentació

- Aplicació: [`apps/gnosi/`](apps/gnosi/)
- Arquitectura: [`apps/gnosi/ARCHITECTURE.md`](apps/gnosi/ARCHITECTURE.md)
- Guia de contribució: [`apps/gnosi/CONTRIBUTING.md`](apps/gnosi/CONTRIBUTING.md)
- Portal d’enginyeria: [gnosi.temenosismael.org/engineering/ca](https://gnosi.temenosismael.org/engineering/ca/)

## Comentaris i contribucions

Si proves Gnosi, el comentari més útil és on es trenca la cadena: instal·lació,
importació, traçabilitat de l’evidència, síntesi o citació. Obre una
[incidència de feedback](https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20El%20meu%20primer%20flux%20amb%20Gnosi)
o consulta la [guia de contribució](apps/gnosi/CONTRIBUTING.md). Les persones
mantenidores poden fer servir el [kit de publicació comunitària](apps/gnosi/docs/community/community-release.ca.md).

## Llicència

Copyright © 2024–2026 Ismael García Fernández.

Gnosi es distribueix sota la
[GNU Affero General Public License v3.0 o posterior](LICENSE). Es pot utilitzar,
modificar i redistribuir sota els termes de la llicència, incloses les
obligacions de disponibilitat del codi font per a usos en xarxa.
