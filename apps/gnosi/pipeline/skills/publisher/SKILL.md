# Skill: Publisher

Aquesta skill s'encarrega d'automatitzar el flux de publicaci\u00f3 des del Vault de la Gnosi cap als canals p\u00fablics (Drupal i Xarxes Socials). Substitueix els workflows de n8n per scripts de Python deterministes.

## Funcionalitats

- **Sincronitzaci\u00f3 amb Drupal**: Converteix fitxers Markdown en nodes de Drupal (Articles, Dissenys, Recursos).
- **Gesti\u00f3 de Traduccions**: Genera autom\u00e0ticament versions en Catal\u00e0, Castell\u00e0 i Angl\u00e8s fent servir OpenAI/DeepL.
- **Publicaci\u00f3 en Xarxes Socials**: Envia el t\u00edtol i l'URL del contingut a LinkedIn, BlueSky i Mastodon.

## Requisits

- Acc\u00e8s al **mcp-drupal-proxy** (Docker).
- Variables d'entorn pr\u00e8viament configurades a `.env_shared`:
  - `DRUPAL_URL`
  - `OPENAI_API_KEY` o `DEEPL_API_KEY`
  - Tokens de LinkedIn/BlueSky (Keychain).

## \u00das (CLI)

```bash
# Sincronitzar articles pendents cap a Drupal
python scripts/sync_vault_to_drupal.py --status "Ready to Publish"

# Publicar un article espec\u00edfic a XXSS
python scripts/broadcast_social.py --page-id "uuid-de-la-pagina"
```

## Manteniment

Tota la l\u00f2gica de mapeig de camps residesix a `scripts/sync_vault_to_drupal.py`. Si Drupal canvia d'estructura (fields), cal actualitzar la funci\u00f3 `map_markdown_to_drupal_fields`.
