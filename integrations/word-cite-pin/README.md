# Gnosi Cite — fixar el panell als documents de Word

Utilitat d'un sol fitxer que fa que el panell de **Gnosi Cite** torni a
obrir-se sol cada cop que obres un document, sense haver de reinserir-lo a mà.

## El problema que resol

Word a macOS no reté mai el botó del ribbon d'un add-in carregat per sideload:
en tancar el programa desapareix i cal tornar-lo a inserir des de *Complements
de desenvolupador*. El diagnòstic complet és a la directiva
`word_addin_persistence.md`.

Office té una funció (*autoopen*) que reobre sola un panell designat, i —
cosa que ens va de cara — Microsoft la va retirar el 2026-03-02 per als
add-ins de la Marketplace però **la va mantenir per als carregats per
sideload**, que és el nostre cas.

El parany és l'atribut `visibility` de `word/webextensions/taskpanes.xml`:

| valor | comportament |
|-------|--------------|
| `0` | l'autoopen només actua **si l'add-in ja està instal·lat** al dispositiu — cosa que a macOS no passa mai amb un sideload. Circular: inútil. |
| `1` | Word reparteix la referència de l'add-in **amb el document** i demana confiança un cop. Funciona. |

`Office.context.document.settings` (Office.js) només sap escriure `0`. El `1`
**només es pot posar per Open XML**, i és exactament el que fa aquest script.

## Ús

```bash
python3 pin_taskpane.py document.docx
python3 pin_taskpane.py ~/Tesi/*.docx          # accepta diversos
python3 pin_taskpane.py document.docx --dry-run
python3 pin_taskpane.py document.docx --undo
```

Sense dependències: només la biblioteca estàndard de Python 3. Modifica el
document al lloc i en desa una còpia `.bak` (desactivable amb `--no-backup`).

És **idempotent**: tornar-lo a executar sobre un document ja fixat no fa res.

L'`<Id>` i la `<Version>` es llegeixen del manifest
(`frontend/public/word-addin/manifest.xml`), no estan duplicats aquí.

## Dos casos, tots dos coberts

- **El document ja ha tingut el add-in inserit un cop**: les parts
  `webextension` hi són amb `visibility="0"`; el script les actualitza.
- **El document no l'ha tingut mai**: el script injecta les cinc peces que
  calen — `taskpanes.xml`, `webextension1.xml`, el seu `.rels`, la relació a
  `_rels/.rels` i els dos `Override` de `[Content_Types].xml`.

En el segon cas el resultat és canònicament idèntic al que escriu el Word pel
seu compte, excepte l'atribut `id` de l'element `<we:webextension>`, que aquí
es deriva del GUID de l'add-in en comptes de ser aleatori — és el que fa el
script idempotent, i cap altra part del paquet el referencia.

## Avisos

- **La versió viatja dins del document.** La referència `webextension` porta
  la versió del manifest. Si puges la versió del manifest, torna a passar el
  script pels documents perquè la referència no quedi enrere.
- **Cal desar el document** perquè res d'això persisteixi: viu dins el fitxer,
  no a la configuració del Word.
- No recupera el botó global del ribbon. Fixa el panell **document per
  document**; per a un de nou, o el passes pel script o l'insereixes un cop.
