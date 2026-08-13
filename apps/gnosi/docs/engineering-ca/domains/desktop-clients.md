---
status: implemented
last_verified: 2026-08-02
source_paths:
  - electron/main.js
  - electron/preload.js
  - electron/electron-builder.yml
  - electron/release.sh
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
