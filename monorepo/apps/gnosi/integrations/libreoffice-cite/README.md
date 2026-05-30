# Gnosi Cite — Extensió per LibreOffice Writer

Extensió tipus Mendeley Cite per inserir referències del Vault de Gnosi
(taula Recursos) dins un document de Writer com a cites formatades +
bibliografia autogenerada.

És la contrapartida del [Word Add-in](../../frontend/public/word-addin/)
i comparteix exactament el mateix backend i pipeline pandoc.

## Què fa

- **Cerca dinàmica**: filtra Recursos per `Citation Key`, `Títol` o `Autor`
- **Inserció amb tracking**: cada cita s'insereix dins un *reference mark* de
  Writer anomenat `gnosicite::<key>::<uuid>`. Això permet reformatar-les si
  es canvia d'estil
- **Bibliografia automàtica**: recopila totes les cites del document i les
  renderitza al final via pandoc-citeproc
- **Estils CSL**: APA 7, Chicago author-date, MLA, IEEE

## Arquitectura

```
[LibreOffice Writer]
   └── Menú "Gnosi Cite"
        ├── Insereix cita…          → gnosicite:insertCitation  (diàleg UNO)
        ├── Insereix bibliografia   → gnosicite:insertBibliography
        ├── Actualitza tot (APA)    → gnosicite:refreshAll
        └── Configuració…           → gnosicite:settings
              ↓ protocol handler (gnosi_cite.py, Python/UNO)
              ↓ urllib (stdlib)
[Gnosi backend]
   ├── GET  /api/health
   ├── GET  /api/vault/search-citations?q=…
   ├── GET  /api/vault/format-citation?key=…&style=apa&locale=ca-AD
   ├── POST /api/vault/format-citations    { keys[], style, locale }  ← APA batch
   └── POST /api/vault/format-bibliography { keys[], style, locale }
              ↓ subprocess
[pandoc + citeproc + CSL styles + locales]
```

Els endpoints són **els mateixos** que utilitza el Word Add-in; no cal cap
canvi al backend.

## Conformitat APA (important)

Igual que al Word Add-in, l'estil APA i altres autor-data tenen regles
**sensibles a context** (sufixos `2020a`/`2020b`, inicials per desambiguar
homònims, `et al.` a partir de la segona aparició). Aquestes decisions
requereixen que pandoc-citeproc rebi **totes les cites del document juntes**.

La inserció puntual (`Insereix cita…`) crida `format-citation` singular per
UX immediata, però sense context complet pot ser sub-òptima.

**Per garantir conformitat APA:**

1. Insereix totes les cites que vulguis amb el diàleg
2. Prem **«Actualitza tot (APA)»** — fa una sola crida `format-citations`
   (plural) amb totes les cites en ordre, incloent duplicats, i actualitza
   el text de cada *reference mark*
3. Prem **«Insereix bibliografia»** per generar la llista final
4. Si canvies d'estil o de locale, repeteix el pas 2

## Requeriments

- LibreOffice 5.0+ amb el component de scripting Python actiu (és el cas a
  les builds oficials de Mac, Windows i la major part de Linux; a alguns
  Linux cal `libreoffice-script-provider-python`)
- Backend de Gnosi accessible (per defecte `http://localhost:5002`) amb
  pandoc instal·lat (ja inclòs a `Dockerfile.backend`)

> El Python embegut de LibreOffice **no** porta `requests`; aquesta extensió
> fa servir només `urllib` de la stdlib.

## Construcció

```bash
cd monorepo/apps/gnosi/integrations/libreoffice-cite
./build.sh          # genera gnosi-cite.oxt
```

## Instal·lació

### Via interfície gràfica (recomanat)

1. LibreOffice → **Eines > Gestor d'extensions… > Afegeix**
2. Tria `gnosi-cite.oxt`
3. Reinicia LibreOffice
4. Obre un document de Writer → apareix el menú **Gnosi Cite**

### Via línia de comandes

```bash
# Mac (ruta típica de l'app)
/Applications/LibreOffice.app/Contents/MacOS/unopkg add --force gnosi-cite.oxt

# Linux / Windows (unopkg al PATH de LibreOffice)
unopkg add --force gnosi-cite.oxt
```

Per desinstal·lar: `unopkg remove com.gnosi.cite`.

## Ús

1. **Gnosi Cite > Configuració…** → posa l'URL del backend (un cop)
2. **Gnosi Cite > Insereix cita…** → s'obre el diàleg:
   - Escriu al cercador (filtra per key/títol/autor)
   - Tria l'estil de citació (APA 7, Chicago, MLA, IEEE)
   - Doble-clic a una entrada (o **Insereix cita**) per inserir-la al cursor
3. Quan tinguis totes les cites: **Insereix bibliografia** i, per APA,
   **Actualitza tot (APA)**

La configuració es desa a `~/.config/gnosi-cite/config.json`.

## Compatibilitat coneguda

- ✅ LibreOffice Writer 5.0+ (Mac, Windows, Linux)
- ✅ Documents `.odt` i `.docx`
- ⚠ **Refresc ordenat (APA)**: recorre només el cos del document. Les cites
  dins capçaleres, peus de pàgina o cel·les de taula es detecten per a la
  bibliografia (claus úniques) però **no** es reformaten en ordre amb
  «Actualitza tot». Limitació coneguda de la v0.1.
- ❌ Apache OpenOffice: no provat (l'API de reference marks hi és, però el
  registre de components Python difereix)

## Troubleshooting

### El menú "Gnosi Cite" no apareix

- Confirma que el document és de **Writer** (el menú té `Context` de text)
- Reinicia LibreOffice del tot després d'instal·lar
- Comprova que el Python scripting hi és: a alguns Linux,
  `sudo apt install libreoffice-script-provider-python`

### "Sense connexió amb Gnosi"

- Verifica que el backend respon a `/api/health`
- Revisa l'URL a **Gnosi Cite > Configuració…**
- En remot cal `https://` amb certificat vàlid

### "Obre un document de Writer primer"

La comanda s'ha despatxat sense un document de text actiu. Obre o crea un
`.odt`/`.docx` i torna-ho a provar.

### Les cites no es reformaten amb «Actualitza tot»

Assegura't que es van inserir amb aquesta extensió (porten el *reference
mark* `gnosicite::…`). Les cites enganxades com a text pla no es poden
re-rendenitzar.
