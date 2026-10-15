# Use mail, calendar and contacts

Connect the accounts you need and keep track of which source owns each message, event or contact.

## Before you begin {#before-you-begin}

Activate Mail, Calendar and Contacts as needed. External accounts need configured credentials or authorization; local events and contacts do not require a cloud account.

## Steps {#steps}

1. In integration settings, add the appropriate account and test the connection. Mail uses IMAP/SMTP; calendars support Google Calendar or CalDAV; contacts support Google or CardDAV alongside local entries.

2. Open Mail and choose the account and folder. Open a message; compose a draft, check recipients and attachments, and send only when it is ready.

3. Open Calendar and select the calendars to display. Create an example event in the intended local or external calendar; check time zone, start, end and recurrence before saving.

4. Open Contacts and create a fictional local contact or synchronize an authorized source. Check the source before editing provider-owned details.

5. Use a contact suggestion in a draft or attendee field and verify the chosen address. A similar display name does not guarantee the same recipient.

6. For meeting recording, enable the relevant feature and grant the required device permissions. Transcription and generated meeting notes need their configured services.

## Expected result {#expected-result}

You can find an account’s mail, an event in the intended calendar and a contact with a known source.

## If something goes wrong {#troubleshooting}

If data is absent, check account authorization and source filters. Hiding a calendar event does not delete it at the provider. Do not reconnect accounts repeatedly or resend mail while its previous operation is still unresolved.

## Related guides {#related-guides}

- [Enable plugins, connect services and automate](integrations-automations.md)
- [Frequently asked questions and recovery](troubleshooting.md)

## CalDAV writes and video calls

Writable CalDAV calendars, including iCloud, support creating, editing and deleting individual events. Updates preserve the resource UID, time zones, all-day dates and untouched iCalendar properties. The provider's ETag prevents overwriting a concurrent change; refresh a conflicting event before editing again. Recurring CalDAV resources remain read-only in Gnosi.

When a provider supplies a video link, open the appointment and choose **Join video call**. The link opens in your browser.

## Availability and public bookings

Open **Availability** in the calendar side panel. Select every calendar that should block bookings, including local Gnosi events and calendars from multiple accounts. Set the time zone, working days and hours, duration, buffer, notice and booking horizon. Check availability, then choose a destination among the selected calendars and create a booking link. You can copy and revoke published links.

Visitors choose an available slot and enter their name and email. Gnosi checks availability again before creating the event. If a selected calendar cannot be checked, bookings stop until it is available. If a provider write has an uncertain result, the slot stays reserved and the visitor sees a pending result; verify the destination calendar before making another reservation. External accounts are available for public booking only to the personal workspace owner.

A public link requires your Gnosi web server to be reachable by its recipients. A localhost or desktop address only works on that device; creating a link does not host or expose your installation.
