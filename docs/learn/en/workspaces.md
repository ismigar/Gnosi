# Workspaces, Vaults and sharing

A workspace determines the people and permissions you work with. A Vault holds the knowledge files. Switching one can change the records and settings you see.

## Before you begin {#before-you-begin}

An existing workspace. Organization installations may require membership and an editor role. External sharing requires its plugin.

## Steps {#steps}

1. Check the workspace name in the switcher before starting a project. Select an existing workspace or use **New Workspace** if your installation permits creation.

2. Open the Vault selector or Settings → General → Files. Select the intended Vault, or create one with a descriptive name such as “Reading group”.

3. Create a test page and reopen it after switching away and back. This confirms which Vault owns the page.

4. For collaboration, manage membership and roles in workspace settings. Give editing access only to people who should change the content.

5. To share a page externally, enable the sharing plugin and use the page’s sharing controls. Check its permissions and expiry, then open the link in a separate browser session to verify what a visitor can see.

## Expected result {#expected-result}

You can identify the active workspace and Vault and verify the scope of a shared page.

## If something goes wrong {#troubleshooting}

A local Vault does not automatically appear on another computer. Workspace membership, file synchronization and public sharing are different mechanisms. Do not delete a Vault to fix a missing workspace; verify the selected account and folder first.

## Related guides {#related-guides}

- [Install Gnosi and take your first steps](getting-started.md)
- [Frequently asked questions and recovery](troubleshooting.md)

## Vault template catalog and moderation

In personal mode, Settings → General → File structure → Vaults → From repository opens the verified catalog. Search, category filters and content previews help select a template; installation creates a new Vault. Publish template opens a searchable inventory of included files, exclusions and potential sensitive content. Refreshing the inventory clears the previous acknowledgement.

## Saved layouts and canvas notes

Saved layouts remember your open notes, drawings, PDF and EPUB readers, the active document and split sizes. Reader positions are restored too. If a target no longer exists, Gnosi reports the problem before replacing the current layout.

On a canvas page card, use **Edit** and **Save** to change its note. Drafts survive switching layouts during the current session; save them before closing the app. JSON Canvas import and export preserve supported cards, connections and custom metadata. An import does not copy attached files, and Gnosi reports unsupported structures.

## Take selected notes offline

Sign in to your Gnosi server, select the account, workspace and Vault, then open the offline notes companion from Settings → General. Create an encrypted collection with a separate passphrase, load the server list and add the text notes you need. Use **Save locally** after editing. After its first successful production load, the companion can reopen without a network connection. On a mobile browser, add it to the home screen; the server must use HTTPS.

Reconnect and synchronize explicitly. If both copies changed, compare the original, local and server text and select or write a merged version. Keep your passphrase: it cannot be recovered, and clearing browser data removes unsynchronized work. Attachments and embedded notes are not downloaded with a note. The server continues using its existing storage; this local encrypted collection is not a backup.

## Publish a collection of notes

With the sharing plugin enabled, open a note’s sharing controls and choose multi-page publication. Select the notes, name the site and optionally set an expiry. Review the public preview before publishing. Its navigation and search only include the selected pages; omitted attachments, private embeds, HTML and saved queries are indicated. Source edits appear publicly only after you preview and publish an update. Revoke the site from the same manager to stop future reads; visitors may have saved copies already.
