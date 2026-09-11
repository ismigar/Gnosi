# Frequently asked questions and recovery

Use the symptom to narrow down the problem before changing settings or copying data. Record the action, message and app version if you need to report an issue.

## Before you begin {#before-you-begin}

Access to the affected installation. Before any recovery, preserve a copy of the current data as well as the backup you plan to restore.

## Steps {#steps}

1. **A section is missing.** Check the active workspace and Vault, open Settings → Plugins and verify that the feature is enabled. Look in the app launcher if it is not pinned to the sidebar.

2. **The model does not respond.** Check the selected agent/model, provider credentials and local service status. For missing actions, check tool support and skills; successful chat alone does not establish them.

3. **An import is incomplete.** Inspect failed items, the source permissions and supported format. Retry a small failed selection after checking for duplicates; do not repeat a full import blindly.

4. **Another computer shows different content.** Confirm that both installations use the intended Vault folder. Check your file-sync provider separately, and reconnect per-device accounts where necessary. Local caches and account databases are not automatically synchronized with Markdown.

5. **Changes conflict.** Preserve your unsaved text, reload the current page and compare versions before saving again.

6. **Data must be recovered.** Close Gnosi and pause file synchronization. Keep a separate copy of the current Vault and application data directory. Restore the backup into a separate folder first, select that Vault and verify pages and original attachments before replacing anything. Credentials and instance-local data may need separate recovery.

## Expected result {#expected-result}

You have isolated the failing feature or verified a restored copy without overwriting the only remaining data.

## If something goes wrong {#troubleshooting}

**Is AI required?** No, the core knowledge workflow works without it. **Is the Vault a complete backup?** It contains knowledge files, but some instance-local data and credentials live elsewhere. See the [data migration guide](https://github.com/ismigar/Gnosi/blob/main/docs/data-migration-3.md). **Where can I report a bug?** Use [GitHub Issues](https://github.com/ismigar/Gnosi/issues), removing private content and credentials from examples.

## Related guides {#related-guides}

- [Install Gnosi and take your first steps](getting-started.md)
- [Enable plugins, connect services and automate](integrations-automations.md)
