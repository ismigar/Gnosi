# Vault Bridge

**Drupal module to synchronize content from Vault databases into Drupal nodes.**
Structured, incremental, and secure integration with the Vault API — optimized for automation and clean architecture.

---

## 🚀 Features

- 🔁 Incremental sync based on `last_edited_time`
- 🧹 Full sync option with automatic cleanup of unpublished content
- 📦 File and image support (attachments from Vault)
- 🗂 Field mapping via JSON config
- 🖥️ Admin UI for manual sync
- 🛠️ Drush commands for CLI-based workflows
- 📊 Dashboard for sync status and node mapping
- 🧱 Clean service-based architecture

---

## 📦 Requirements

- Drupal **9.4+** or **10.x**
- PHP **8.1+**
- A [Vault integration token](https://developers.vault.com/docs/getting-started)

---

## 🔐 API Key Setup

**Configure the Vault API key via `settings.php` (not the UI):**

```php
$settings['vault_migration.api_key'] = 'secret_xxx_from_vault';
```

## 📄 Changelog
See [CHANGELOG.md](CHANGELOG.md) for a list of recent changes.

## 📄 License
This module is licensed under the GNU General Public License v2 or later. See [LICENSE.txt](LICENSE.txt).
