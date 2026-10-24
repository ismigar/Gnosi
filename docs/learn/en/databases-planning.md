# Organize records and plan work

A database groups tables. A table defines properties for page records; its views show the same records in different ways.


Date fields share one editor with independent single-date/period and optional-time controls. A period can span several days with separate start and finish clocks; its finish may remain pending. Natural duration is inclusive calendar days without clocks, and elapsed hours with clocks. Switching modes keeps the saved interval and clocks; project-planning options remain available. Start, finish, duration, recurrence and scheduling-rule help follow the selected interface language.

In a view embedded in a page, a filter such as **Container = This page** automatically fills that property with the containing page when you add a record. This works with any table, including records created from templates and subitems. New records therefore remain in the view when that page relation was the missing value.

Hover over an image property or an image file’s name or open button to see a larger preview in page properties, tables, galleries and feeds. Image links in URL properties also show a preview. Focusing a link or button with the keyboard shows the same preview; **Escape** dismisses it. Existing thumbnails and click actions stay available.

## Before you begin {#before-you-begin}

A writable Vault. General table views are part of the knowledge workflow; advanced project scheduling requires the Planning plugin.

## Steps {#steps}

1. In Knowledge, choose **Create a DB** or **Add database** and name the group “Reading project”. Create a table within it, called “Sources”. Creating the group alone does not create a table.

2. Add properties such as a status and a date. Keep a short, consistent set of statuses, for example “To read”, “Reading” and “Read”.

3. Create two records and fill their properties. Expand **Content** under the table to open their pages; expand **Views** to find saved views.

4. Create a filtered view for unread sources. Choose a board or calendar view when the corresponding status or date fields are useful, and check which records match the filter.

5. For scheduled tasks, activate Planning and configure its working week and holidays. Set a start, duration and dependencies for a small example before applying scheduling rules to a real project.

6. Use the help beside a date constraint to understand the selected rule. Check the calculated finish against the expected working days.

For continuous reading, open the gallery settings and choose **Card size → Full width** and **Card preview → Content**. Cards use the entire view width, appear one below another and grow to fit their text. In a grouped gallery, **Space** expands the focused group and enters its first note; **Escape** from a note returns to the group header and collapses it. A second **Escape** returns to the view. Clicking the group header still toggles it.

In the **timeline**, choose **Day**, **Week**, **Month**, **Year**, **Today**, or **Fit project**. Resize the title column and collapse phases. With an editable period or start and end fields, drag a bar to move the task and its edges to extend or shorten it. Drag the connection point at the end of a task onto a successor’s bar to add a finish-to-start dependency. Changes are saved to the records shared with the table; affected successors are rescheduled even when hidden by filters. Cycles are rejected. **Undo timeline change** restores the last operation during the current view session. **Esc** cancels a drag. With a bar focused, arrow keys move it and **Shift + arrow** adjusts the end. Undated records show **Set dates**; milestones appear as diamonds.

To remove a dependency, click the line connecting the tasks and confirm **Remove dependency**. Dates are preserved and you can undo the change.

## Expected result {#expected-result}

You can view the same records as a table or a filtered view and explain a calculated task date.

## If something goes wrong {#troubleshooting}

An empty view may simply have a restrictive filter. Check dates, statuses and dependencies before recreating records. Creation and modification dates are maintained by Gnosi and are not editable planning dates.

## Related guides {#related-guides}

- [Create pages, links and attachments](pages-files.md)
- [Enable plugins, connect services and automate](integrations-automations.md)

## Public table forms

Enable **External sharing**, then open a table and choose **Public forms**. Publish a form with a title, description, selected questions, help text, required fields and an expiry. Supported questions include text, numbers, dates, email, URLs, phone numbers, checkboxes and table choices. Formula, relation and internal fields are not exposed.

Share the generated link from a Gnosi server your visitors can reach. They can submit a response without a Gnosi account and cannot read existing records. Each accepted submission creates one page in the pinned table through the normal page pipeline. Retrying an interrupted submission uses the same request identity and does not create another record. Revoke the link to stop new submissions. Removing the owner's write access or changing an exposed field's schema also stops the form.

Links always expire: choose 7, 30, 90 or 365 days when publishing. Publish a new form when you need a new link after expiry.
