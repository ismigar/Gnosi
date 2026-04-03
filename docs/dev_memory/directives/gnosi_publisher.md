# Directiva: Gnosi Publisher (Reconstrucció de n8n)

Aquesta directiva substitueix el workflow de n8n que automatitzava el flux de publicació del Digital Brain. El sistema es basa en **Skills de Python** deterministes que actuen com a "pont" (bridge) entre el Vault de la Gnosi (Notion/Markdown) i els canals públics (Drupal/XXSS).

## 1. Mapatge de Dades (Recuperat de la Memòria)

El sistema ha de respectar el segu\u00fcent mapatge entre l'\u00edd de la base de dades de Notion i la taula local/Drupal:

| Nom | ID Notion (UUID) | Taula Drupal (Gnosi) |
| --- | --- | --- |
| Articles | `270268e5271480ca8b47fa9f28904287` | `articles` |
| Dissenys | `22e268e527148061bdf0cc752b016e70` | `designs` |
| Recursos | `8c80f2a861b843b790da4f0e260b7db9` | `resources` |
| Col\u00b7laboradors | `245268e52714801ab698cfa44429c2cb` | `collaborators` |
| XXSS | `ebe282f0a2e145afbd76cd2036b37882` | `social_media` |

## 2. Flux de Publicació (SOP)

El flux s'executa en tres fases principals:

### Fase A: Ingesta i Traducci\u00f3
1. **Trigger**: El monitor detecta un article nou o actualitzat amb `status: Ready to Publish`.
2. **Traducci\u00f3**: S'activa la Skill de traducci\u00f3 (OpenAI/DeepL) cap als idiomes actius (Catal\u00e0, Castell\u00e0, Angl\u00e8s).
3. **Persist\u00e8ncia**: Es generen els fitxers Markdown localment per cada idioma.

### Fase B: Sincronitzaci\u00f3 amb Drupal (`recursos.pangea.org`)
1. **Mapeig**: Es tradueix el contingut de Markdown a nodes de Drupal (Notion blocks -> Drupal Fields).
2. **Push**: S'envia el contingut a Drupal via **mcp-drupal-proxy** o SSH/Drush.
3. **Feedback**: Es guarda l'\u00edd del node de Drupal al fitxer Markdown original per evitar duplicats.

### Fase C: Difusi\u00f3 a XXSS
1. **Broadcast**: Un cop el node de Drupal est\u00e0 publicat, s'envia el t\u00edtol i l'enlla\u00e7 a:
   - LinkedIn
   - BlueSky / Twitter
   - Mastodon

## 3. Restriccions i Errors Comuns (Hist\u00f2ric)
- **Error d'\u00edd**: No feu servir l'\u00edd de Notion directament com a \u00edd de Drupal. Drupal necessita auto-increment o guid.
- **Format Markdown**: Drupal de vegades t\u00e9 problemes amb el format MD si no es neteja pr\u00e8viament.
- **Traduccions parcials**: No publiqueu si una de les traduccions obligat\u00f2ries ha fallat.
