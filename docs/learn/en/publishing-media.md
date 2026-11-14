# Prepare media and publish content

The media center holds reusable assets. Social publishing prepares and sends content to the networks you configure.

## Before you begin {#before-you-begin}

Enable Social Publishing and connect the target network with permission to publish. Use an example draft while learning.

## Steps {#steps}

1. Open Media, add an image you are allowed to use, and review its metadata. Open the original to check its quality and availability.

2. Open the social composer and select the intended network and account. Write a draft and attach the asset.

3. Review the preview for each destination, including text length and media limits. Adapt the content separately when networks have different requirements.

4. Choose immediate publication or set an explicit schedule. Check the destination, date and time before confirming; preparation alone does not publish.

5. After execution, open publication history. Check each network’s outcome and the resulting remote link.

6. If one destination failed, inspect that result before retrying. Keep successful destinations out of the retry to avoid duplicates.

## Expected result {#expected-result}

Your draft has a checked destination and, after publication, a verifiable result for each network.

## If something goes wrong {#troubleshooting}

Expired credentials or provider limits can block a publication. A thumbnail cannot restore a missing original asset. A scheduled action also depends on the required plugin, account and running service remaining available.

## Related guides {#related-guides}

- [Enable plugins, connect services and automate](integrations-automations.md)
- [Frequently asked questions and recovery](troubleshooting.md)

## Publish a website

Enable **Websites**, open it from the sidebar and create or select a website. Choose the source tables and pages, then configure navigation and appearance. Upload a logo, favicon or font through the appearance controls. Only selected assets enter the published website; an upload alone does not publish it. System fonts depend on the visitor’s device.

Configuration saves automatically. Wait for the save status before reviewing and publishing to the selected destination. Publication is an explicit action. If saving fails, keep the draft and retry before publishing. Private service credentials and newsletter drafts are separate from the public website; sending a campaign requires its own review and explicit action.

### Review, release history and test newsletters

In Contents, choose a source before adding it; explicitly select the public fields, body and attachments. Use Pages for manual content and Navigation for menus.

Configuration saves automatically. Check the save status and resolve failures before leaving. Review a snapshot, its changes and its desktop/mobile preview before publishing the reviewed version. Source or configuration changes require a fresh review. Check the job outcome and release history; rollback restores a website version, while messages, subscribers and campaign state remain separate.

In Newsletters, choose the destination and language, then add already published content to a digest or featured-reading draft. The list shows the newest content first. Reorder up to twenty unique pages, add an introduction and review HTML, plain text and recipients before explicitly queuing a test. Drafts save automatically per site and destination; changed publications or edits require another review. Captured test messages can be read from the delivery queue; reading does not activate confirmation or unsubscribe links. Use the explicit test-link controls when needed.

The current pilot permits protected test publication and captured email for synthetic recipients only. Production publication and real email delivery are disabled. A destination also needs its required renderer and private-service dependencies; use its connection check before publication. If an action’s outcome is uncertain, refresh status before retrying.

### Import a website and configure its connection

In **Create website**, choose a blank website or URL import. Enter its public address, analyze it and review the pages, languages and warnings before importing the selection. This creates editable pages without publishing. Original server applications and form handlers are not migrated automatically.

In **Hosting**, configure the server, port, user, folders and authentication using the SSH agent, a device key or a password. Transfer files using SSH or SFTP; passwords are stored only in the device credential manager. Test the connection: publication with the private service also requires SSH commands, PHP and SQLite. An SFTP-only connection can be verified without meeting those publication requirements.

In **Contact forms**, add, reorder or remove fields and edit language-specific text, including consent, errors and confirmation. Leave optional text blank to retain its defaults. Review the result before publishing.

Record previews avoid repeatedly rebuilding the same website. Each new preview still reads your current notes and checks the record again after rendering. If it changes during review, start a fresh review. Preparing or reopening a preview never publishes or changes the selected content.

For unchanged, downloaded attachments, preview reuses a verified local copy. Notes are read afresh. If a cloud file cannot be read promptly, review stops instead of waiting indefinitely: download the file and try again. Confirmation checks the original files again before publication.
