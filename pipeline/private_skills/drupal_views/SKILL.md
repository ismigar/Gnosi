# SKILL: Drupal Operations

This skill is responsible for the management and maintenance of the Drupal server, including deployments, configuration updates, and view translations without GUI access.

> ID: DRUPAL-OPS-20260408
> Status: ACTIVE
> Location: `pipeline/private_skills/` (handles SSH credentials — NOT public)

---

## Restrictions / Edge Cases

- **SSH credentials in `.env_shared`**: this skill reads `SSH_HOST`,
  `SSH_USER`, `SSH_PASSWORD`, `SSH_PORT`, and `DRUPAL_PATH`. It must remain
  under private `pipeline/private_skills/`, never public `pipeline/skills/`.
- **`.env_shared` resolution**: scripts use
  `Path(__file__).resolve().parents[7] / ".env_shared"`. Update `parents[N]`
  if the directory hierarchy changes.
- **Runtime outside Docker**: this skill uses remote SSH rather than Docker.
  Docker-specific parts of `environment_integrity.md` do not apply.
- **Partial idempotency**: scripts upload temporary PHP to
  `/tmp/<name>.php` and remove it at the end. A crash can leave an orphaned
  file on the remote server; inspect `/tmp/` after failures.
- **Caches**: after translation changes, run `flush_cache.py` to regenerate
  `config:views`, `rendered`, and `http_response`.
- **Repeated application**: writes to `language.config_factory_override` are
  idempotent. Re-running `translate_views.py` overwrites the same values and
  does not create duplicates.

---

## 1. Standard Maintenance (Drush)
Whenever possible, use the `drupal-proxy` MCP to interact with Drush.

- **Common Commands**:
  - `drush cr`: Clear cache.
  - `drush cim`: Import configuration.
  - `drush updb`: Run database updates.

---

## 2. View Translation via PHP (Advanced)
When the MCP/Drush fails due to permissions or deep configuration strings need to be edited (Labels, Headers, "Read more").

### PHP Bootstrap Protocol
To interact with Drupal from the agency:
1. Create a temporary PHP script on the server.
2. Include the autoloader (`vendor/autoload.php`).
3. **Class Fix**: If `mysql` fails, manually register the namespace:
   ```php
   $loader->addPsr4('Drupal\\mysql\\', '/path/to/web/core/modules/mysql/src');
   ```

### Configuration Changes
```php
$storage = \Drupal::service('language.config_factory_override')->getStorage('en-gb');
$config = $storage->read('views.view.my_view');
$config['label'] = 'New Label';
$storage->write('views.view.my_view', $config);
```

---

## 3. Payload Management (Notion -> Drupal)
When publishing articles from the pipeline:
- **Validation**: The payload must respect the Drupal entity schema.
- **Relations**: Taxonomy fields must be mapped by UUID, not by name.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-03-15 | MySQL Class Not Found | Incomplete autoloader | Manual registration of the PSR-4 namespace in the bootstrap script. |
| 2026-04-07 | Blocked Cache | `drush cr` failure | Direct SQL use: `TRUNCATE TABLE {cache_render}`. |
| 2026-04-08 | Doc Dispersion | Docs vs Skill | Consolidation of all operational knowledge into `SKILL.md`. |

---
*Maintenance: Before any "Level 4" operation (SQL Truncate), always perform a database backup.*
