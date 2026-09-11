# Enable plugins, connect services and automate

Plugins make optional features available in a Vault. Integrations connect accounts. Automations run configured operations on a schedule.

## Before you begin {#before-you-begin}

Permission to change the active Vault’s settings and, for connected actions, an authorized account. Enable User Automations to manage user schedules.

## Steps {#steps}

1. Open Settings → Plugins in the intended Vault. Review a plugin’s purpose and permissions, then activate it. Its configuration appears in the appropriate settings group.

2. Add a supported integration and test its connection. Keep credentials in the account settings rather than copying them into notes or prompts.

3. For a Notion import, enable the import plugin, authorize the source and choose a small selection first. Review pages, tables and attachments after import before expanding the scope.

4. Open Automations and configure an operation, its destination and schedule. Start with a small, non-publishing task so you can check the result.

5. Enable the task and inspect its execution history after it runs. Verify the actual imported or updated content as well as the reported status.

6. Pause a task before changing its account or destination. Recheck its configuration before enabling it again.

## Expected result {#expected-result}

The feature is available in the intended Vault and a scheduled task has a result you can verify.

## If something goes wrong {#troubleshooting}

Schedules need a running Gnosi service; a closed desktop app cannot execute local jobs. Disabling a plugin pauses its functionality without making its old account configuration proof that it is active.

## Related guides {#related-guides}

- [Workspaces, Vaults and sharing](workspaces.md)
- [Frequently asked questions and recovery](troubleshooting.md)
