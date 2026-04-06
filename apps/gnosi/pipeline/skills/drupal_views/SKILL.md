# Directive: Drupal Views Translation via SSH

## Goal
Translate configuration strings (Titles, Headers, Empty Text) and fix decoupled Content Entities (Menu Links) without GUI access.

## Context
When standard MCP/Drush fails due to environment permissions or connection issues, we use **Python -> Temporary PHP Scripts**.

## Level 1: Standard Configuration Translation (The Happy Path)
Use this for View Labels, Page Titles, and Header/Footer text defined in `.yml`.

1.  **Bootstrap:** Create a PHP script.
    -   `chdir(PROJECT_ROOT)` (e.g. `webapps/web` where `vendor` and `composer.json` live).
    -   `require 'vendor/autoload.php'`.
2.  **Apply:**
    ```php
    $storage = \Drupal::service('language.config_factory_override')->getStorage('en-gb');
    $config = $storage->read('views.view.my_view');
    $config['label'] = 'New Label';
    $storage->write('views.view.my_view', $config);
    ```

## Level 2: Advanced Bootstrap (The "Manual Autoload" Fix)
If you get `Class "Drupal\mysql\..." not found`, the autoloader misses `core` mapping.
**FIX:** Manually register the namespace in your script.
```php
$loader = require_once '/full/path/to/vendor/autoload.php';
$loader->addPsr4('Drupal\\mysql\\', '/full/path/to/web/core/modules/mysql/src');
```

## Level 3: "Anar a..." / "Read More" Links
These are often hidden in **Display Options** under `use_more_text`.
**CRITICAL:** Check ALL displays (`default`, `page_1`, AND `block_1`).
```php
$config['display']['block_1']['display_options']['use_more_text'] = 'Go to Blog';
```

## Level 4: The "Nuclear" Option (Persistent/Content Strings)
If a string (like a Menu Link) persists despite config updates, it is likely a **Content Entity** (`menu_link_content`) effectively decoupled from the config.
**Solution:** Direct SQL Update + Table Truncation.

1.  **Update Content:**
    ```php
    $db = \Drupal::database();
    $db->update('menu_link_content_data')
       ->fields(['title' => 'New Title'])
       ->condition('title', 'Old Title')
       ->execute();
    ```
2.  **Nuke Caches (When API fails):**
    If `drupal_flush_all_caches()` crashes:
    ```php
    $tables = ['cache_menu', 'cache_render', 'cache_page', 'cache_config', 'menu_tree'];
    foreach ($tables as $t) $db->query("TRUNCATE TABLE {{$t}}");
    ```
    *Warning:* Truncating `menu_tree` forces a rebuild on next page load.

## Verification
Always verify by `curl`ing the frontend from the server itself to check the rendered HTML.
```bash
curl -k -L https://site.url/en-gb | grep "Expected String"
```
