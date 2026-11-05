---
status: implemented
last_verified: 2026-10-17
source_paths:
  - backend/services/podcast_brief_review.py
  - backend/services/podcast_automatic.py
  - backend/services/podcast_brief_edits.py
  - backend/agent/behavior/operations/podcast/revision-contract.md
  - backend/agent/behavior/operations/podcast/brief-review-contract.md
  - backend/agent/behavior/operations/podcast/assignment-contract.md
  - backend/services/podcast_outline.py
  - backend/services/podcast_policy.py
  - backend/domains/configuration/source_sections_schema.py
  - frontend/src/features/vault/properties/sourceSectionRelations.ts
  - backend/domains/llm_wiki
  - backend/services/llm_wiki.py
  - backend/services/llm_wiki_reading_runtime.py
  - frontend/src/shared/notifications/resourceProcessingError.ts
  - frontend/src/features/vault/properties/FileAttachmentField.tsx
  - backend/domains/reader
  - backend/domains/literature
  - backend/domains/literature/review_logic.py
  - backend/domains/literature/connectors
  - backend/api/reader.py
  - backend/models/reader.py
  - backend/models/pdf_annotation.py
  - backend/api/vault_routes.py
  - backend/domains/vault/citations/exporting.py
  - backend/domains/vault/citations/normalizers
  - backend/domains/vault/citations/cover_metadata.py
  - backend/domains/vault/citations/metadata_lookup.py
  - frontend/src/features/vault/dashboard/useSources.ts
  - frontend/src/shared/resources/pdfCover.ts
  - backend/api/literature_routes.py
  - backend/services/literature_models.py
  - backend/services/academic_connectors.py
  - backend/services/lookup_normalizers.py
  - backend/services/literature_service.py
  - backend/services/literature_review_service.py
  - backend/services/literature_import_service.py
  - backend/services/literature_ai_service.py
  - backend/services/references_io.py
  - backend/services/import_dedup.py
  - backend/services/audio_summarizer.py
  - backend/services/podcast_feedback.py
  - backend/services/podcast_briefing.py
  - backend/services/podcast_feedback_repair.py
  - backend/agent/behavior/operations/podcast/feedback-contract.md
  - frontend/src/features/reader
  - frontend/src/features/literature
  - frontend/src/features/literature/settings/ResourcesPluginConfig.tsx
  - frontend/src/features/reader/zotero/ZoteroReaderTab.ts
tests:
  - backend/tests/test_podcast_brief_edits.py
  - backend/tests/test_podcast_bounded_rewrites.py
  - backend/tests/test_podcast_synthesis_context.py
  - backend/tests/test_podcast_preparation.py
  - backend/tests/test_podcast_feedback.py
  - backend/tests/test_podcast_feedback_repair.py
  - backend/tests/test_podcast_feedback_repair_transport.py
  - backend/tests/test_reader_source_registry.py
  - backend/tests/test_reader_source_routes.py
  - backend/tests/test_feed_ingester_savepoint.py
  - backend/tests/test_mail_ingester_savepoint.py
  - backend/tests/test_pdf_extraction_cache.py
  - backend/tests/test_llm_wiki_source_sections.py
  - frontend/src/features/vault/properties/sourceSectionRelations.test.ts
  - backend/tests/test_llm_wiki_recovery.py
  - backend/tests/test_llm_wiki_contextual_reading.py
  - backend/tests/test_llm_wiki_reading_runtime.py
  - frontend/src/shared/notifications/resourceProcessingError.test.ts
  - backend/tests/test_reference_covers.py
  - frontend/src/features/vault/dashboard/useSources.test.tsx
  - frontend/src/shared/resources/pdfCover.test.ts
  - frontend/src/features/vault/properties/FileAttachmentField.test.tsx
  - backend/tests/test_reader_analysis_domain.py
  - backend/tests/test_pr6_domain_facades.py
  - backend/tests/test_vault_export_domain_contract.py
  - backend/tests/test_citation_key_and_pubmed.py
  - backend/tests/test_references_io.py
  - backend/tests/test_import_dedup.py
  - backend/tests/test_llm_wiki_pdf_annotations.py
  - backend/tests/test_e2e_import_references_item_type.py
  - backend/tests/test_literature_models.py
  - backend/tests/test_academic_connectors.py
  - backend/tests/test_academic_connectors_domain_contract.py
  - backend/tests/test_lookup_normalizers.py
  - backend/tests/test_html_meta_attr_order.py
  - backend/tests/test_literature_service.py
  - backend/tests/test_literature_import_service.py
  - backend/tests/test_literature_review_service.py
  - frontend/src/features/reader/ReaderDashboard.test.tsx
  - frontend/src/features/reader/page/ReaderArticleContent.test.tsx
  - frontend/src/features/reader/page/ReaderResourceButton.test.tsx
  - frontend/src/features/reader/public-entry.test.ts
  - frontend/src/features/literature/LiteraturePage.test.tsx
  - frontend/src/features/literature/public-entry.test.ts
  - frontend/src/features/literature/settings/ResourcesPluginConfig.test.tsx
---

# Lector, referències i citacions

Els dominis de frontend amb tipatge estricte `features/reader/` i
`features/literature/` gestionen les seves pàgines, components locals, estat
i proves. Cadascun exposa una entrada pública diferida, de manera que la
lectura de canals i la cerca bibliogràfica es carreguen independentment.
Els estils de Literatura mantenen l'ordre de cascada existent dins de la
funcionalitat. Els adaptadors compartits de peticions, la integració Zotero,
la configuració de proveïdors i la renderització de citacions no es dupliquen
en aquests dominis.

Les rutes, l'emmagatzematge, l'anàlisi i les fonts del Reader viuen ara a
`backend/domains/reader/`; els repositoris, la cerca, la sincronització i
l'emmagatzematge bibliogràfic, a `backend/domains/literature/`. Els mòduls antics
es mantenen com a façanes compatibles.

L'anàlisi del Reader que depèn del vault, l'accés a resultats, la represa,
la cancel·lació, la recuperació d'articles antics i la generació de pòdcasts
passen per una única comprovació de vault actiu. Si falta context, retornen
una resposta recuperable de servei no disponible abans de crear treballs o
fils; les rutes vàlides del vault i els payloads existents es mantenen estables.
La generació de pòdcasts consumeix directament el generador canònic tipat de
sessions de base de dades i el tanca al bloc `finally` existent; no hi ha cap
conversió de tipus ni fàbrica duplicada de sessions entre l'orquestració del
Reader i la persistència.

Les rutes HTTP, els models canònics i els serveis de revisió sistemàtica estan
tipats estrictament. El recompte PRISMA, les transicions de cribratge,
l'evidència d'accés obert i les exportacions CSV/JSON/Markdown/SVG viuen al
domini pur `review_logic.py`; les funcions històriques continuen com a façanes.

## Portades automàtiques i plantilles de recursos

La creació des d'una font carrega les plantilles de la taula abans de comparar
el tipus Zotero detectat, incloses les etiquetes traduïdes. La plantilla
corresponent aporta contingut i valors inicials; les metadades importades tenen
prioritat, però es conserva una portada existent de la plantilla. Sense
coincidència s'utilitza la plantilla predeterminada. Els registres nous no
hereten els indicadors de plantilla.

La consulta ISBN conserva la portada de l'edició d'Open Library. Les consultes
DOI i web utilitzen la imatge declarada per l'editor mitjançant la consulta
existent d'URL públiques. La portada és opcional i no condiciona les metadades.
Si el PDF pujat no té portada proposada ni de plantilla, el navegador genera
un JPEG acotat de la primera pàgina i el desa a Assets/Covers abans de crear
el recurs. El PDF original continua adjunt. Els errors de generació o pujada
de portada no impedeixen crear el recurs. Les portades en línia són URL
externes; les generades del PDF són fitxers locals. L'enriquiment mostra una
previsualització i no preselecciona substituir una portada existent.

Un únic avís de progrés es manté visible després de tancar el diàleg de cerca.
Indica la preparació, la pujada del PDF, la generació de la portada, el desament
i l’obertura a mesura que comença cada etapa. El mateix avís confirma l’èxit
quan el registre s’ha obert, o mostra un error si la creació falla. Les
importacions per identificador mostren només les etapes aplicables.

## Metadades bibliogràfiques completes

Els camps `Autoría`, `Editors`, `Traductors` i la resta de rols CSL de Recursos fan servir l’editor de tipus `autoria`. La configuració `citation_role` i les metadades internes `_citation_roles` mantenen els rols diferenciats quan es reanomenen els camps. La compleció de l’esquema és additiva i idempotent.

L’esquema Zotero fixat genera `reference_catalog.py` i `referenceCatalog.ts` amb `pipeline/skills/zotero_schema/scripts/build_reference_catalog.py`. Els dos conversors CSL comparteixen el catàleg de camps i dates, conserven any, mes i dia i aprofiten les dades antigues de `Zotero Extras`. La importació acadèmica conserva les metadades bibliogràfiques complementàries durant la deduplicació i la importació.

BibTeX i RIS inclouen els camps i rols compatibles. El camp `gnosimetadata` i l’etiqueta `GN` conserven, en una extensió només bibliogràfica, els dos cognoms, les entitats, els tipus de recurs i els camps que el format no representa. Gnosi els recupera en reimportar, respectant els canvis externs als camps estàndard. Altres programes poden descartar aquesta extensió i no garanteixen recuperar les dades sense equivalència al format. Se n’exclouen les rutes locals i les propietats personals alienes a la bibliografia.

## Responsabilitat

Aquest domini combina la lectura de canals i butlletins amb un gestor de
referències compatible amb Zotero, renderització de citacions CSL, importació
per identificadors i web, lectura PDF/EPUB i anotacions que poden esdevenir
evidència citable.

## Ingestió de referències

Crossref, Open Library, arXiv, PubMed i les metadades HTML tenen normalitzadors
tipats separats a `backend/domains/vault/citations/normalizers/`. Conserven els
payloads canònics de Zotero i el comportament de funció pura, mentre que
`backend/services/lookup_normalizers.py` continua sent la façana compatible.

Les referències entren per DOI, ISBN, arXiv, PMID, BibTeX, RIS, fitxers o URL
web. Els resolutors d'identificadors i Zotero translation-server produeixen
metadades específiques del proveïdor. Els normalitzadors les mapen a l'esquema
configurat, generen una clau de citació estable, dedupliquen candidats i
escriuen un registre al vault.

`backend/services/references_io.py` és el límit tipat i determinista de BibTeX/RIS.
Els seus ajudants petits d'anàlisi, normalització, mapatge de camps i serialització
preserven l'ordre, l'escapat, la resolució del tipus i el contracte públic
d'importació/exportació, sense persistència ni xarxa ocultes.
El deduplicador pur d'importacions utilitza estructures explícites de metadades
i índexs d'identificadors. Manté la prioritat clau de citació, DOI, ISBN i
títol normalitzat; una entrada creada en la mateixa importació s'afegeix
idempotentment als mateixos índexs. Les entrades del catàleg CSL i el mapatge
declaratiu de Zotero a Recursos exposen contractes serialitzables explícits,
preservant els extres arbitraris del proveïdor al límit JSON extern. Els
ressaltats de citacions gestionats per Brain utilitzen mapatge tipat SQLAlchemy;
l'única excepció sense tipatge queda a l'adaptador opcional `pypdfium2`, que
no publica el marcador `py.typed`.

L'orquestració de consulta, que és només de lectura, viu al domini de citacions,
manté la prioritat DOI → arXiv → PMID → ISBN → URL i fa passar les URL aportades
per l'usuari pel descarregador protegit contra SSRF abans de suggerir cap camp.
La taula de Recursos designada es llegeix d'una configuració canònica única;
només els vaults heretats que mai no s'han configurat poden adoptar automàticament
la primera taula amb Citation Key, sota el mateix bloqueig que Configuració.

El servidor de traducció és un servei auxiliar opcional. L'execució nativa pot
prescindir-ne; els resolutors específics d'identificador i les referències
existents continuen funcionant. Les fallades de traducció web retornen errors
que orienten la resolució, en lloc de presentar un registre buit com un èxit.

`citations/pdf_fallback.py` deriva un registre citable de les metadades PDF quan
falla la resolució d'identificadors. `citations/web_capture.py` selecciona i
mapeja resultats Zotero, i `platform/translation_server.py` gestiona el transport HTTP.

## Descobriment acadèmic federat

El connector integrat Recursos gestiona la configuració de repositoris;
`/api/vault/reference-table` continua sent l'única font de veritat de la taula
Recursos de destinació. `/literature` executa cada connector seleccionat
independentment i transmet resultats parcials; els errors de quota o proveïdor
s'associen a aquella font sense descartar els resultats correctes.

`backend/domains/literature/connectors/` gestiona el transport HTTPS acotat,
l'auditoria de peticions, la normalització canònica, OAI-PMH i JSON personalitzat,
els grafs de citacions i els adaptadors per família de proveïdors.
`backend/services/academic_connectors.py` és només una façana de compatibilitat.
El port tipat resol els col·laboradors de la façana en cada crida perquè les proves
i integracions puguin substituir transport, validació, parsers i dispatch sense
duplicar estat mutable.

L’adaptador de Dimensions tracta `dimensions_api_key` com una clau API. Cada cerca
envia primer `{ "key": "..." }` a `https://app.dimensions.ai/api/auth` amb POST,
valida el token retornat i envia la consulta DSL en UTF-8 a `/api/dsl/v2` amb
`Authorization: JWT <token>`. El token s’obté per a cada cerca i no es desa.
Cal disposar d’una subscripció amb accés a l’API de Dimensions habilitat.

El transport POST compartit manté la validació HTTPS, els temps límit, els límits
de mida i els errors segurs de credencials i quota. Rebutja les redireccions per
no reenviar la clau ni el token. L’auditoria registra el mètode HTTP real sense
incloure el cos de la petició ni les capçaleres d’autorització. Els tokens absents
o invàlids i els errors de consulta es comuniquen com a errors del connector.
`backend/tests/test_dimensions_connector.py` verifica el flux i els errors amb
respostes HTTP simulades; la validació real requereix una clau API habilitada.

`AcademicWork` és el contracte canònic dels connectors. Les unions deterministes
utilitzen, per ordre, DOI normalitzat, PMID o PMCID, identificador arXiv sense
versió, ISBN-13 i títol normalitzat més any i cognom del primer autor. Una
coincidència aproximada de títol només és un avís. Les obres fusionades conserven
totes les aparicions a les fonts, ubicacions obertes, recomptes de citacions
per proveïdor, procedència de cada camp i variants en conflicte.

La previsualització és de només lectura. Adjuntar el text complet és una acció
manual separada, disponible només per a una ubicació oberta verificada. La
importació passa l'obra fusionada pel mapatge compartit de Recursos compatible
amb Zotero i repeteix la comprovació d'identitat sota un bloqueig atòmic. Si
ja hi ha un registre de Recursos coincident, l'API el retorna sense duplicar-lo.

L'adaptador d'importació concreta tots els objectes imbricats del proveïdor
—publicació, identificadors, dates, ubicacions d'accés obert i extres Zotero—
en un únic límit de mapatge abans de convertir-los. Els payloads de creadors
només es mantenen intencionadament heterogenis al punt de connexió amb Zotero;
les claus deterministes d'obra, la injecció de claus de citació, la pertinença
als quaderns i la reutilització de duplicats mantenen el comportament existent.

## Revisions de literatura

L'estat de revisió sistemàtica es desa en quatre taules del vault gestionades
idempotentment: `Literature Reviews`, `Literature Activities`,
`Literature Candidates` i `Literature Decisions`, aquesta última només amb
addicions. Les estratègies de cerca, les consultes exactes als proveïdors, els
errors parcials, les operacions d'IA, les decisions de cribratge i les
exportacions continuen sent auditables i sincronitzades amb el vault principal.

El cribratge amb un revisor i el doble cec comparteixen el mateix model de
fases. En mode cec, la decisió d'un revisor s'oculta fins que tots dos l'han
enviada; els conflictes passen a consens explícit. La IA pot proposar consultes
editables, reordenar, cribrar o sintetitzar metadades recuperades, però no pot
excloure candidats ni afirmar evidència més enllà del títol, resum o text
complet efectivament proporcionat.
Tant l'alternativa per coincidència de tokens com el reordenador opcional
d'embeddings locals utilitzen un mateix registre tipat de classificació,
preservant l'ordre per puntuació i posició original entre les implementacions.

Els índexs OAI i l'estat temporal de cerca es poden reconstruir i resideixen
sota `LOCAL_DATA`; protocols, historials, candidats, decisions i artefactes
d'auditoria es mantenen al vault principal. Les credencials de repositori
utilitzen Keychain natiu o l'entorn de desplegament i mai no s'escriuen al
vault ni a l'estat del connector.
Les files OAI filtrades conserven la llista canònica tipada d'obres del
connector sense conversions posteriors. L'OCR PDF opcional i l'anàlisi EPUB
limiten les excepcions de tipatge als imports exactes de `pypdfium2` i
`ebooklib`, paquets que no publiquen `py.typed`; els objectes dinàmics no
surten de l'adaptador de documents.

## Flux de citació

```mermaid
flowchart LR
    Record["Pàgina de referència"] --> CSL["Normalització de l'element CSL"]
    CSL --> Citeproc["Motor citeproc + estil seleccionat"]
    Citeproc --> Text["Citació dins del text"]
    Citeproc --> Bibliography["Bibliografia"]
    Annotation["Anotació PDF"] --> Evidence["Cita o evidència persistent"]
    Evidence --> Record
```

Els valors CSL deriven del frontmatter de referències amb mapatges de camps
explícits. Les llistes de noms, dates, tipus d'element, escapament BibTeX/LaTeX
i metadades `extra` de Zotero requereixen normalització. L'esquema fixat
protegeix els tipus i camps compatibles davant dels canvis del projecte d'origen.

`backend/domains/vault/citations/exporting.py` gestiona la neteja del Markdown,
la resolució del subconjunt de citacions, els marcadors de bibliografia,
l'execució de Pandoc i el paquet de descàrrega. La ruta de compatibilitat
conserva la signatura pública i injecta els ports de fitxers, CSL i processos.

## Lector i anotacions

El lector Zotero inclòs mostra PDF i EPUB. Gnosi gestiona el pont que localitza
fitxers, serveix intervals de bytes segurs, rep anotacions i enllaça l'evidència
seleccionada amb registres del vault. Les anotacions inclouen URI d'origen,
pàgina, tipus, geometria, text, comentari, etiquetes, clau gestionada estable
i marques temporals.

Els endpoints de fitxers validen el confinament i gestionen la hidratació del
núvol. Els identificadors persistents d'anotació impedeixen duplicar una cita
generada cada vegada que es reobre el document.

El processament conserva totes les cites a les notes i en selecciona un
subconjunt per ressaltar al PDF. Una heurística local compara cada cita completa
amb el títol i el cos de la nota, donant preferència a l'evidència principal.
Es ressalta com a màxim el 15% del text d'una pàgina, amb un màxim de dues cites
sense solapaments i de passatges diferents. Són límits, no quotes obligatòries;
les cites llargues o poc adequades continuen a les notes sense ressaltat.
La validació de la geometria de totes les cites és independent d'aquesta
selecció visual. Tornar a sincronitzar elimina només els ressaltats obsolets
gestionats pel recurs; conserva les anotacions manuals i les d'altres recursos.

Les propietats de fitxer obren els adjunts PDF i EPUB al lector intern amb
l’acció compartida d’obertura. Els camins relatius al vault es converteixen en
URL d’actius servits; els enllaços locals i els URL externs de documents utilitzen
la mateixa ruta del lector. Si cap tauler gestiona l’esdeveniment d’obertura,
es navega a la pàgina del lector. Obrir un adjunt no modifica el valor desat de
la propietat. Els actius del lector es compilen amb l’script existent i no
s’inclouen al control de versions.

## Canals i butlletins

Els models del Reader desen fonts, articles, estat de lectura, contingut
complet extret i un compte de butlletins. La ingestió de canals utilitza
savepoints de transacció perquè una entrada malformada no reverteixi tot el
lot. Els extractes i l'extracció de text complet són separats; truncar durant
la ingestió no ha de descartar permanentment contingut d'origen recuperable.

## Navegació del lector i desament a Recursos

La llista manté visibles els articles llegits i no llegits. Les fletxes amunt i
avall mouen el focus entre articles i desplacen la llista per mostrar la fila
seleccionada. Quan el focus es manté en una fila durant 500 ms, el lector obre
l'article i el marca com a llegit. Moure el focus, canviar de font o sortir de la
llista cancel·la l'obertura pendent; un clic obre l'article immediatament. Els
canvis d'estat de lectura conserven l'article seleccionat i la posició de la
llista. El cos es carrega sota demanda, i una resposta tardana d'una selecció
anterior no pot substituir el cos actual.

L'acció manual de marcar com a llegit se substitueix per Afegir a Recursos quan
el connector Recursos està activat. L'acció espera el cos complet de l'article i
comprova `/api/vault/reference-table`; si no hi ha destinació configurada, mostra
un error que indica com resoldre-ho sense crear cap registre. El desament crida
`/api/vault/literature/imports` amb el títol, la data de publicació, el nom de la
font, l'URL original i el text del cos. L'importador existent resol la taula
designada i gestiona la persistència; el lector no introdueix una segona
configuració de taula ni una via separada d'escriptura de registres.

Les notícies utilitzen `newspaper-article`, mapat a `newspaperArticle` de Zotero.
Si no hi ha un identificador bibliogràfic més fort, la deduplicació de notícies
utilitza l'URL HTTP(S) original sense el fragment abans de considerar títol, any
i autor. La clau desada permet reutilitzar el recurs existent en importacions
repetides encara que l'article tingui un altre identificador local al lector.
El botó impedeix desaments simultanis, informa de l'èxit i permet reintentar
després d'un error.

## Invariants

- Les claus de citació són estables tret que l'usuari canviï explícitament dades d'identitat.
- La importació deduplica per identificadors autoritatius i metadades normalitzades.
- La fallada d'una font federada no pot invalidar resultats ja retornats per altres fonts.
- La similitud aproximada no fusiona mai obres acadèmiques automàticament.
- Les mètriques de citacions es mantenen separades per proveïdor i no se sumen mai entre si.
- Els suggeriments d'IA no es converteixen en decisions finals de cribratge sense acció humana.
- Les rutes de fitxers del lector no poden sortir de les arrels permeses.
- La identitat del document i la geometria de pàgina d'una anotació sobreviuen als reinicis.
- Els components interns del lector inclòs es tracten com a codi del projecte
  d'origen; els canvis locals d'integració són explícits i reproduïbles.
- Les contrasenyes de configuracions antigues de butlletins es tracten com a
  secrets encara que un model antic exposi un camp de compatibilitat.

## Aspectes que cal verificar

Executeu proves de claus de citació, PubMed, tipus d'element, estils CSL,
escapament BibTeX, entrada/sortida de referències, anotacions, confinament de
rutes, deduplicació d'importacions i savepoints de canals. Afegiu proves de
normalització de connectors, tokens i marques d'eliminació OAI, SSRF/XML,
errors parcials, cegament de revisions, importacions concurrents i recomptes
PRISMA. La validació al navegador ha d'obrir un document de prova real i
comprovar un cicle de citació o anotació; després ha de fer una cerca progressiva
de literatura, inspeccionar-ne la procedència i importar un resultat deduplicat.

## Processament de fonts completes i temps d’espera

El processament conserva la capacitat de context del model seleccionat i envia les
fonts completes quan hi caben. El límit de context i el temps d’execució són independents.
Les peticions de més de 96.000 bytes UTF-8 disposen de fins a 900 segons per intent i
1.920 segons en total; les fases més petites mantenen 240 segons per petició i 360 en
total. Es mantenen els límits de cinc intents i 120 segons d’espera entre intents.
El llindar només modifica el temps d’espera, mai el contingut ni la fragmentació.

Els errors de temps d’espera desen un missatge útil, traduït al diàleg i a les
notificacions. La lectura dirigida copia els plans desats al nou treball abans de
contactar amb el proveïdor per conservar el progrés si falla un nou intent.
Les crides estructurades respecten el mateix límit de context que la resta de lectures.

## Fitxers del lector PDF

El lector PDF integrat necessita tots els fitxers generats de Zotero a `frontend/public/zotero-reader`. Cal executar `bash scripts/runtime/build-zotero-reader.sh` abans de compilar una còpia nova. Vite comprova els fitxers d’entrada i de sortida, incloent-hi el motor PDF, el worker, el visor i la llengua alternativa. L’empaquetat d’escriptori utilitza el mateix validador. Les actualitzacions només de la interfície també han de copiar aquest directori; si falta el host, l’espera s’esgota abans d’obrir el document. Tant el CI de la interfície com les releases preparen aquests fitxers.

Quan l’evidència d’una cita té l’adreça de la font buida, s’utilitza el document adjunt del recurs. Les adreces locals dels adjunts i les rutes HTTP del vault actiu comparteixen la mateixa pestanya del lector i la identitat de les anotacions. El lector carrega els ressaltats existents de totes dues formes d’URI, elimina duplicats segons l’identificador de la base de dades i desa les anotacions noves amb l’URI canònic de l’adjunt. Les anotacions generades i manuals continuen disponibles sense tornar a processar la font; els documents d’altres vaults i les adreces externes mantenen identitats separades.

## Assignació de camps a les notes generades

Cada font selecciona `assignment_field_ids` independentment de `index_field_ids`. Si la llista no existeix, es conserva el comportament anterior basat en índexs; una llista buida desactiva les assignacions. Les regles admeten `ai`, `source`, `fixed` i `empty`. Només es poden assignar camps editables. Els valors d’IA segueixen esquemes tipats i els valors categòrics han de pertànyer a les opcions existents. La còpia i els valors fixos conserven zero i fals; les regles buides esborren el valor en reprocessar, mentre que eliminar una regla conserva les metadades existents.

El resolutor compartit `backend/domains/llm_wiki/options.py` consulta `config.catalog_ref` del vault actiu abans de les opcions locals, de manera que la configuració i el processament utilitzen els mateixos valors categòrics. Un `agent_id` antic buit selecciona l’agent principal. L’editor espera que les regles de còpia i valor fix siguin completes abans de desar. Les proves de regressió inclouen `backend/tests/test_llm_wiki_field_assignments.py` i `backend/tests/test_llm_wiki_processing_domain_contract.py`.

## Apartats de les fonts i paratext

El processament exclou de les notes les portades, les metadades editorials, les
cites inicials i els pròlegs o prefacis, tret que l'usuari els demani explícitament.
La cobertura registra aquests passatges i es mantenen com a context.

El Brain conserva `Position` (Posició) numèrica i afegeix una relació única `Section` (Apartat) amb una
taula gestionada d'apartats de les fonts. Els encapçalaments originals conserven
la jerarquia, el text i identificadors diferents encara que no estiguin numerats
o repeteixin títol. Cada apartat pertany a una font i un document d'entrada; els
selectors rebutgen apartats d'altres fonts. Els filtres d'igualtat seleccionen
un apartat; els d'inclusió també els seus descendents. Les pàgines i marques de
temps es mantenen a les citacions. L'àudio i el vídeo utilitzen els capítols
originals disponibles; no se n'inventen.

L'actualització de l'esquema preserva les notes i no inicia cap processament.
El reprocessament explícit assigna apartats i marca els desapareguts com a antics,
conservant les relacions històriques. L'aplicació deriva les assignacions dels
segments verificats, també quan reprèn un punt de control revisat.


### Evidència PDF estable i cerca de cites

L’extracció PDF es desa localment amb el SHA-256 de tots els bytes del fitxer,
la versió de l’extractor i una suma de comprovació del text ordenat i els
localitzadors. L’estimació i el processament comparteixen l’extracció: repetir
l’OCR no invalida una lectura desada si el PDF no ha canviat. Les peticions
simultànies comparteixen una sola extracció. Els bytes modificats, les entrades
corruptes, l’OCR fallit i els fitxers que canvien durant l’extracció no poden
reutilitzar ni publicar aquesta memòria cau. L’absència d’OCR en pàgines amb
imatges és un error explícit; les pàgines en blanc són vàlides. Els recursos
natius es tanquen també quan hi ha errors. La memòria cau conserva l’evidència,
però no certifica la precisió de l’OCR.

La geometria de cites indexa els caràcters natius una sola vegada per pàgina i
sincronització. Els índexs no es comparteixen entre fitxers ni sobreviuen a la
sincronització. Es mantenen les comprovacions de la cita sencera, de les lletres
exactes i de l’ambigüitat; només s’elimina la lectura repetida dels caràcters.

Si PDFium retorna un glif desconegut U+FFFE, un segon descodificador PDF el pot
recuperar només si tota la pàgina normalitzada té la mateixa longitud i tots els
altres caràcters coincideixen. El valor no es dedueix de la cita sol·licitada;
qualsevol altra diferència impedeix la recuperació. Es conserven els índexs de
geometria natius originals.

Les subscripcions es desen de manera autoritativa a
`<Vault>/.gnosi/reader_sources.json` (versió 1). Les files SQLite locals en són una
projecció identificada per URL. El primer accés migra les fonts existents si no hi
ha registre; els accessos posteriors recuperen una base local nova després de
moure el Vault o canviar el directori de dades. Els identificadors continuen sent
locals i es conserven els vincles dels articles existents. Els articles, l'estat
de lectura i les credencials del compte de newsletters continuen a SQLite local;
moure el Vault no trasllada aquests registres.

La creació i eliminació de fonts, la importació OPML i els remitents de newsletters
desen el registre atòmicament abans de confirmar la projecció local. Un bloqueig
local serialitza els canvis i torna a llegir el registre. Una llista buida és
autoritativa i una base antiga no pot ressuscitar fonts eliminades. Les metadades
invàlides, de versió desconeguda o no disponibles al núvol produeixen un error
reintentable sense sobreescriure-les. Les URL amb usuari i contrasenya incrustats
s'han de netejar abans de migrar. El bloqueig local no coordina escriptures
simultànies de dispositius diferents; s'aplica la gestió de conflictes del núvol.

Les adreces de newsletters també admeten `newsletter://address@example.test` i es
desen com a `mailto:address@example.test`, també en importar OPML o el registre.
Es rebutgen duplicats entre els dos formats i àlies amb contrasenyes, delimitadors
codificats, controls, camins o paràmetres. La normalització conserva els vincles
dels articles. Les entrades RSS i mailto existents mantenen el comportament;
l’àlies no configura cap compte de correu ni credencials.

### Cobertura del dia complet i articles sense contingut

El mode de revisió predeterminat és `brief`: revisa la narració amb les notes de les fonts i els temes, permet com a màxim una reescriptura correctiva i, si es reescriu, torna a revisar la narració final abans de generar la veu. La narració ha de superar la revisió. Les auditories exhaustives dels fragments originals i les tres rondes completes d’escriptura i revisió com a màxim descrites a continuació corresponen al mode explícit `full`. La selecció de fonts i les garanties de recompte de paraules i publicació són comunes als dos modes; l’apartat de preferències editables de més avall descriu el flux predeterminat.

El pòdcast diari fixa tots els articles publicats durant les 24 hores anteriors,
inclosos els ja llegits, i exclou els datats en el futur. Els reintents conserven
la selecció, el període, l'idioma i el nom del fitxer dins del treball principal
privat, també en captures antigues sense recursos de comportament.

La generació normalitza el cos complet de l'article i després prova el resum del
canal. Els articles sense cap dels dos s'ometen abans de la síntesi. L'estat exposa
`skipped_articles` amb identificadors i títols; el Lector mostra un avís localitzat.
Si cap article és llegible, `podcast_no_readable_articles` conserva l'MP3 anterior.
Els avisos corresponen exclusivament al treball i les seves entrades fixades.

`podcast_briefing.py` divideix els originals complets en parts i lots de fins a
vuit parts. Cada part té com a màxim 10.000 tokens comptats i ha de produir una
nota no buida amb una cita literal de l'original, un resum de fins a 400 caràcters
i una cita de fins a 160. Les entrades absents, sobrants o amb cites incorrectes
fallen abans de desar-se. Els punts de recuperació privats i versionats no
depenen de la memòria opcional de conversa del model.

`podcast_outline.py` classifica conjuntament totes les targetes amb els seus
resums quan la petició cap dins del límit de 80.000 tokens i del context de
l'aplicació, amb un màxim de 32 grups editorials. Les col·leccions més grans fan
servir una jerarquia acotada de fins a 48 targetes i 40.000 tokens per petició,
respectant el context. Els camps obligatoris d'assignació cobreixen cada
identificador opac. El servidor expandeix les fonts, valida particions exactes
sense duplicats i conserva tots els assumptes de cada grup.

El redactor automàtic produeix una única narració natural. Les peticions inicials grans poden utilitzar digests temàtics amb la pertinença de les fonts controlada per l’aplicació; les correccions conserven l’evidència original. Cada fet substantiu d’una font requereix una decisió explícita de cobertura. Un detall secundari es pot agrupar amb un fet ja cobert, però l’agrupació no pot fer desaparèixer un tema minoritari independent.

El recompte de paraules orienta la composició sense imposar una quota exacta. La tolerància de durada per defecte és del 20%: un objectiu de deu minuts admet aproximadament entre vuit i dotze minuts. Cal mesurar separadament la durada real de l’àudio; l’estimació de paraules no demostra la durada de l’MP3.

Si el guió inicial queda fora de la durada orientativa, la crida restant de redacció rep l’esborrany rebutjat, l’objectiu de paraules i les fonts preparades. Els episodis curts amb un màxim inferior a 2.048 paraules utilitzen una llista global de paraules pronunciables per a tota la narració. El proveïdor i la validació local rebutgen la prosa enganxada, els marcadors de transport i els elements de més de 128 caràcters. Gnosi ancora la substitució al guió original complet, reconstrueix totes les paraules retornades i aplica la mateixa revisió semàntica abans de la veu. Els paràgrafs són flexibles i no hi ha límits per tema. Els episodis més llargs conserven la selecció de passatges originals o escurçats complets. Si falta context, la crida redacta un nou guió amb les mateixes fonts i el mateix objectiu. El planificador distingeix el fitxer desat, l’absència d’articles i l’error. Els esquemes de sortida natius d’OpenAI i DeepInfra ometen la paraula clau d’unicitat no admesa abans del transport. L’esquema complet comprova la unicitat durant la validació local. El transport d’OpenAI també omet els enums literals amb cometes dobles o barres inverses. Les opcions completes es mantenen al missatge de l’operació i a la validació local.

Un esborrany automàtic revisat es corregeix amb edicions locals fonamentades en les fonts, també quan es detecten moltes omissions. Cada edició s’ha d’ancorar al text original exacte i al hash immutable de l’esborrany, ha de donar resposta a les incidències requerides i ha de preservar la prosa fora del seu interval. Si la correcció no cap en el context existent, la generació falla explícitament en lloc de substituir tot l’episodi. La narració corregida passa una revisió semàntica final abans de la síntesi de veu. El mode breu permet dues revisions semàntiques i una correcció; l’aprovació queda vinculada a la revisió actual de la política. La revisió breu comprova els resums aportats i no certifica tots els matisos de cada article original. La revisió completa amb `podcast_review.py` conserva les seves comprovacions d’evidència. L’informe `podcast-coverage-report` registra el mode efectiu i la validació final.

Reprendre un pòdcast conserva la selecció congelada d’articles i les instruccions, i actualitza el model, la ruta del proveïdor i el raonament configurats explícitament. Els resums preparats només es reutilitzen si coincideix l’empremta completa de les fonts; la preparació antiga ha de coincidir amb els originals congelats exactes i les cites literals. Els pòdcasts completats amb una política d’aprovació obsoleta es poden revalidar mitjançant la represa normal; les altres operacions completades conserven la protecció existent.

La selecció d’un model ha de considerar conjuntament el proveïdor real, el raonament, la capacitat útil de sortida, el context i el termini. Cal validar aquesta combinació amb una jornada representativa, incloent-hi la revisió final del contingut, la durada mesurada de l’MP3 i la reproducció nativa. Canviar de proveïdor no selecciona un altre algorisme editorial. Els adaptadors poden simplificar l’esquema enviat a un endpoint fixat o utilitzar transport JSON, però l’esquema complet original es continua validant localment. Una represa correcta amb preparació desada no mesura el rendiment d’una jornada sencera des de zero. Canviar la configuració de l’agent no implica cap ruta alternativa ni crida addicional al model.


### Guies internes de correcció acotades

Quan les objeccions confirmades, totes soles, superen el pressupost de context
del redactor, les operacions de resum acotades produeixen una guia de correcció
obligatòria per a cada objecció. El redactor rep un transport compacte en
columnes amb tots els identificadors, tipus i àmbits de font originals; les
objeccions fonamentades completes i les confirmacions es conserven als punts
de control existents. Això no aprova les objeccions ni la narració. Les
revisions de fidelitat, cobertura i episodi complet contra les fonts originals
continuen condicionant la publicació del guió reescrit. No augmenta cap límit
de context, paraules, crides, temps o rondes semàntiques.

Les guies internes utilitzen un alfabet ASCII imprimible restringit per
l'esquema, sense cometes dobles, barres inverses ni caràcters de control.
Per tant, el límit dinàmic de caràcters coincideix amb el límit de bytes UTF-8
amb doble serialització, com a màxim 160 bytes; el backend també comprova
la mida codificada real. Les sortides invàlides passen per la reparació de
validació acotada existent i no arriben al redactor sense comprovar.
Les fonts originals, les objeccions confirmades completes i la narració final
en català conserven el text Unicode. Aquesta restricció de transport no canvia
les fonts incloses ni aprova l'episodi final: les revisions semàntiques completes
i el pressupost de paraules continuen sent obligatoris abans de locutar o publicar.

L'esquema enviat al proveïdor utilitza una àncora final portable en lloc d'una
asserció anticipada, que Xiaomi rebutja com a petició invàlida. El backend exigeix
independentment ASCII imprimible i exclou cometes dobles, barres inverses i salts
de línia, inclòs el salt final que alguns validadors regex accepten. Es mantenen
l'esquema tancat, els identificadors exactes de les objeccions i el límit real de bytes.

La reparació de guies internes inspecciona tots els valors retornats, en lloc de
limitar-se al primer diagnòstic de l'esquema. L'última crida existent del model
rep exactament tots els identificadors invàlids, les objeccions originals
confirmades, els recomptes reals de caràcters i bytes serialitzats i un objectiu
orientatiu inferior al límit estricte existent. El pedaç no pot afegir claus ni
reescriure guies vàlides. L'aplicació restaura el mapa complet i repeteix les
comprovacions originals d'esquema, alfabet i bytes abans de desar-lo. Si cal,
s'omet l'esborrany intern rebutjat per excés de mida; es mantenen les objeccions
originals i els recomptes, dins del límit de context existent de 40.000 tokens.
No canvien les crides permeses, el termini compartit ni les revisions semàntiques finals.

Si una guia rebutjada conté Unicode invàlid, no té un recompte de bytes UTF-8
vàlid. El text intern s'exclou de la reparació i el recompte es marca com a no
disponible; es conserven l'objecció original confirmada i el nombre de caràcters.
La substitució continua subjecta als mateixos controls d'ASCII imprimible i bytes.

El patró enviat al proveïdor també codifica el mateix límit dinàmic de bytes amb un quantificador acotat. Això fa explícit el límit als serveis que no apliquen de manera fiable el camp separat `maxLength`. Es mantenen el límit de l’esquema, la validació local d’ASCII i bytes i les revisions semàntiques completes.

Les correccions de longitud transporten el mateix flux complet i ordenat de paraules en una sola cadena `token_text`, en lloc d’un element JSON per paraula. L’esquema del proveïdor comprova la cadena i totes les exclusions sense un patró global de recompte; el servidor imposa el mateix interval exacte de paraules locutades abans de la revisió semàntica o la veu. Les respostes fora de l’interval passen per la correcció automàtica acotada existent, amb el recompte mesurat i l’objecte original rebut del model. Es comproven tots els marcadors ordenats, les exclusions explícites i els matisos, i es conserva la lectura dels arrays antics. No es retalla ni se substitueix manualment cap text. Es mantenen les revisions de fidelitat, cobertura i conjunt de l’episodi, i els límits de context, crides i temps. Els temps d’espera reals del transport amb recompte restringit motiven aquesta separació; només una generació automàtica real completada pot acreditar el resultat.

## Preferències editables del podcast diari

La skill assignada `core.gnosi-daily-briefing` conté el criteri editorial i un bloc JSON `podcast_preferences` dins les instruccions editables. Es pot personalitzar a Configuració → IA. Per defecte demana deu minuts i un màxim de dotze grups temàtics. El mateix bloc configura el llindar d’articles, les paraules per article i la longitud mínima dels dies amb poc contingut. `podcast_policy.py` només llegeix la skill canònica efectiva, inclosa una personalització assignada; els articles, altres skills i el context del bot no poden establir aquests paràmetres. Els blocs parcials hereten els valors originals. Una configuració invàlida, duplicada o ambigua falla abans de cridar el model. Cada tasca fixa les preferències resoltes, les passa a la planificació, redacció i revisió, i les registra a l’informe de cobertura.

El planificador pot retornar menys temes que el màxim configurat; ja no omple els dies amplis fins a 32 posicions. Cada targeta conserva exactament una assignació a un tema declarat i es mantenen tots els identificadors i assumptes originals. El motor conserva els límits tècnics, les validacions d’esquema i evidències, la revisió de les fonts originals, el rang de paraules, la persistència, la cancel·lació i les garanties de publicació. Canviar la durada modifica l’objectiu; el valor per defecte dels dies amplis continua sent 1.380 paraules.

El `review_mode` editable és `brief` per defecte: una revisió global dels resums de fonts i temes principals, com a màxim una reescriptura correctiva i, després de reescriure, una nova revisió de la narració final abans de publicar la veu. `full` activa explícitament les auditories exhaustives dels fragments originals. Les metadades de revisió desades identifiquen l’abast real.

En el mode `brief` per defecte, es preparen simultàniament com a màxim quatre lots independents. Cada lot conserva la petició i la clau de memòria cau originals, el context autenticat i la validació; els resultats es reordenen segons les fonts. La cancel·lació o una fallada impedeix publicar una cobertura parcial. La represa reutilitza els mateixos punts validats. El raonament opcional per defecte del proveïdor es desactiva per a l’extracció quan el model declara que ho permet; es respecten les opcions explícites del perfil. El mode `full` explícit manté l’extracció seqüencial.

La síntesi breu utilitza el pressupost de context resolt del model seleccionat, després de les reserves existents per a la resposta i les instruccions. La planificació, la redacció i la revisió única reben directament totes les notes de fonts quan hi caben, sense forçar resums intermedis amb un topall independent de 80.000 unitats. Es mantenen el recompte conservador i la comprovació final del límit de cada petició. Els contextos petits conserven la compressió alternativa; el mode `full` explícit manté el topall de síntesi de 80.000 unitats.

Les reescriptures semàntiques breus en mode `brief` mantenen el contracte de llista `word_tokens_v1` quan el màxim de paraules més els marcadors de grup no supera 2.048 elements. Les reduccions només de longitud en mode `brief` utilitzen la mateixa llista limitada quan hi són elegibles; les altres reparacions inicials mantenen el transport compacte `word_text_v1`; el servidor continua imposant el mateix rang global exacte de paraules, els marcadors ordenats i les exclusions abans de la revisió o la veu. Una composició `brief` massa llarga utilitza la petició existent de reducció només de longitud encara que tota l’evidència hi càpiga: conserva la composició rebutjada exacta, les indicacions mesurades actuals, tots els grups de temes i tots els identificadors de fragments, sense reenviar els resums originals ni observacions semàntiques antigues. Aquest pas només pot escurçar prosa sustentada; després, l’única revisió del dia continua rebent tots els resums originals. L’ampliació de textos massa curts manté l’evidència. No es retalla prosa ni s’imposen topalls rígids per grup, i els límits de crides, etapes, context i temps no canvien. El mode complet i els episodis llargs mantenen el comportament existent; els transports admesos desats continuen sent llegibles.

La planificació agrupa els relats repetits i els angles complementaris d’un mateix fet abans de repartir els grups. Evita dedicar diverses posicions a un sol esdeveniment mentre amaga àmbits minoritaris en grups genèrics. La revisió breu comprova la cobertura concreta de tots els subtemes abans de la fidelitat factual; el títol d’un grup no acredita les seves línies independents. Es poden comprimir detalls rutinaris, però l’absència d’un àmbit substantiu o d’una investigació d’interès públic continua sent una omissió material. Es mantenen una sola revisió i els límits de crides, temps i sortida existents.

Quan un esborrany revisat en mode `brief` ja compleix el rang global de paraules i totes les evidències caben en el context seleccionat, la correcció semàntica utilitza `grounded_edits_v1` en lloc de regenerar l’episodi. El model retorna substitucions limitades, amb ancoratges únics en l’esborrany immutable exacte, índexs d’incidències des de zero i el seu SHA-256. El servidor rebutja empremtes antigues, ancoratges ambigus o superposats, incidències no referenciades i un resultat fora del rang de paraules. La prosa no afectada es conserva literalment; es mantenen disponibles totes les notes de fonts, els grups temàtics i les incidències. L’etapa conserva dues crides, 300 segons i el límit de tokens de sortida. No es publica cap canvi parcial i la generació normal de veu només continua després de validar. Les reescriptures completes i les primeres reparacions de longitud conserven els transports anteriors.


Les correccions factuals poden superposar-se parcialment amb un passatge citat en la seva posició original; compartir paraules en un altre lloc no vincula una correcció. La petició inclou el recompte original i el marge net global de paraules. La validació retorna conjuntament els errors d’ancoratge, incidències i longitud dins del mateix pressupost de reparació; els recomptes parcials s’identifiquen i no es publiquen. Les afirmacions de la revisió es contrasten amb totes les evidències perquè els fets descrits es mantinguin diferenciats de les normes que infringien.

Quan hi ha clàusules literals completes disponibles, `grounded_anchor_ids_v1` utilitza una substitució o valor nul per cada identificador d’àncora del servei i exigeix totes les assignacions de troballes. El valor nul conserva la clàusula original literalment; una cadena buida la suprimeix deliberadament. El model no recopia les àncores originals. El servei restaura l’esquema original, el hash, les àncores disjuntes, totes les troballes i el pressupost de l’episodi. La reparació restant `grounded_edit_alternatives_v1` exigeix dues variants íntegres, una de compacta i una de més extensa, per a cada identificador fix. Cada variant ha de resoldre les troballes assignades. El servidor només tria frases íntegres proposades dins del rang global de paraules de substitució, restaura els marcadors i repeteix els validadors originals i la revisió semàntica final. No es retalla text ni es fixa una quota de paraules per clàusula; es mantenen el termini i les crides.

Una substitució rebutjada perquè repetia el text pot conservar la seva àncora original única en la mateixa reparació restant de paraules. La substitució ha de canviar realment i resoldre les troballes assignades; es continuen rebutjant les edicions obsoletes, ambigües, solapades, incompletes o encara idèntiques. Així es tracta també el pressupost complet sense ampliar l’abast de les edicions ni les crides.
