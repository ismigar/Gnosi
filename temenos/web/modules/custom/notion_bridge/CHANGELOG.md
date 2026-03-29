# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] – 2025-07-23

### Added
- Initial stable release.
- Incremental and full synchronization from Notion databases.
- JSON-based configuration UI for database mappings.
- Support for custom field mapping, images, and file attachments.
- Drush command `nb-sync` with `--full` option.
- Smart `hook_cron()` logic (full sync only at 23:00).
- Manual execution form in the admin UI.
- Sync status table with filtering by DB, node type, and publication.
- Error logging and safety limits (max 30 deletions per full sync).

---

## [Unreleased]

### Planned
- Asynchronous queue-based syncing for large datasets.
- Database-level sync logs.
- Unit and functional test coverage.
- Sync health dashboard with visual indicators.
