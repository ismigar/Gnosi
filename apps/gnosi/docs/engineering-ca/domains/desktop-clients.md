---
status: implemented
last_verified: 2026-08-15
source_paths:
  - electron/main.js
  - electron/preload.js
  - electron/electron-builder.yml
  - electron/package.json
  - electron/release.sh
  - frontend/package.json
  - frontend/src/content/releases.json
  - web-clipper
  - integrations/libreoffice-cite
  - integrations/word-cite-pin
tests:
  - integrations/libreoffice-cite/tests
---

# Clients d'escriptori i company

## Escriptori electrònica

Paquets electrònica Gnosi com a aplicació d' escriptori. El procés principal propietari del dorsal en engegar, s' està netejant, ferm, rutes de vida de finestra, paquetd- font, actualitzacions de comprovacions, descàrregues, instal· lació i accions d' escriptori privilegiades. El renderitzador rep un API estret en comptes de l' accés directe al node.js.

El dorsal per al Python embalat ha d' estar llest abans que el renderitzador tracta l' aplicació com usable. Els errors d' inici estan en superfície amb diagnòstics i la neteja impedeixen processos de dorsal orfes després de sortir de la finestra.

## Actualitza la màquina d' estat

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Checking: renderer ready
    Checking --> Available
    Checking --> Current
    Checking --> Error
    Available --> Downloading: user confirms download
    Downloading --> Ready
    Downloading --> Error
    Ready --> Installing: user confirms restart
```

Les comprovacions estan deshabilitades en el desenvolupament. Les baixades mai comencen simplement perquè existeix un alliberament. El procés principal desa l' estat d' actualització, de manera que un renderitzador que subscripti fins tard es pot recuperar a través del PCPC.

Els artefactes de llançament inclouen instal· lats i metadades actualitzadores per a MacOS, Windows i Linux. La versió de preparació manté la Frontal i els manifests electrònica alineats; les etiquetes només es creen des de revisades. `main` Comencions.

## Preparació de versions

`frontend/src/content/releases.json` és l'historial canònic de versions inclòs
al paquet. El sincronitzador manté idèntiques les versions del manifest del
frontend, del manifest d'Electron i de l'entrada del frontend al lockfile del
monorepo. Una entrada estable preparada abans de publicar-se omet expressament
`downloadUrl`; aquest camp només s'afegeix quan existeixen l'etiqueta immutable
i els artefactes de cada plataforma.
Com que la versió del manifest del frontend és un límit d'escriptori d'alt
impacte, cada pull request de preparació d'una release també actualitza aquest
contracte revisat i els seus miralls localitzats, encara que el patch no canviï
el comportament en temps d'execució.
La validació del changelog normalitza els finals de línia abans de comparar-los,
de manera que un checkout Windows amb CRLF equivalent no faci fallar el gate
d'empaquetatge multiplataforma.

Abans de crear l'etiqueta, la PR de release ha de superar la validació del
frontend, els tests backend, la QA nativa al navegador i la porta de
documentació d'enginyeria. Després del merge, el workflow de sincronització ha
de portar el commit revisat al repositori públic, on ha de superar el release
readiness. El workflow del repositori privat és l'únic propietari de les
etiquetes oficials, els artefactes multiplataforma, els catàlegs signats, les
notes i l'esborrany del repositori públic. El workflow d'escriptori sincronitzat
al repositori públic només s'executa manualment, de manera que pot validar
l'empaquetatge sense competir amb un build oficial. Els artefactes de macOS,
Windows i Linux es revisen abans de publicar-los.

## clipper web

L' extensió del navegador extraieu el títol de la pàgina actual, URL, seleccionat o llegibles, i les metadades acceptades, després envia una sol· licitud limitada a l' API del Gnosi. El dorsal realitza autenticació, sanitització, desuplicació i Vault escriu. L' extensió no rep accés a sistema de fitxers arbitraris.

## Clients de citació de LibreOffice i Words

L' extensió LibreOffice registra un gestor de protocol i crida als punts finals de citació del Gnosi del procés d' oficina. El Word helper manté el paginador de tasques i l' estat requerit per accedir al mateix servei local. Ambdós clients tracten la inserció de cita i la bibliografia com a mutacions explícites del document.

Les API específiques de l' oficina estan aïllats darrere dels traverals i les seves transversions per tal que les proves puguin simular el límit de l'ONU o afegir-ne sense necessitat de l'aplicació completa de cada prova d'unitat.

## Invariants

- El codi Render no té cap capacitat de nocicle.js o sistema de fitxers.
- El PCP expos les operacions amb entrades validades.
- Actualitza les baixades i instal·lacions requereix accions explícites d' usuari.
- Els camins de recursos empaquetats difereixen dels camins del desenvolupament i es resolen a
Temps d' espera.
- Autenticació de clients de composició per al dorsal i segueixen- lo en el seu estret
Captura o àmbit de citació.
- Els esborranys de llançament estan inspeccionats abans de publicar-los.

## Concentrat de verificació

Executa les comprovacions de sintaxi electrònica/build, proves de fum de dorsal empaquetades, proves d' estat actualitzats, validació de l' extensió, proves de citació i plataforma CI. local de MacOS no poden provar defectes de Windows o Linux.
