# Organize records and plan work

A database groups tables. A table defines properties for page records; its views show the same records in different ways.

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

In the **timeline**, choose **Day**, **Week**, **Month**, **Today**, or **Fit project**. Resize the title column and collapse phases. With an editable period or start and end fields, drag a bar to move the task and its edges to extend or shorten it. Drag the connection point at the end of a task onto a successor’s bar to add a finish-to-start dependency. Changes are saved to the records shared with the table; affected successors are rescheduled even when hidden by filters. Cycles are rejected. **Undo timeline change** restores the last operation during the current view session. **Esc** cancels a drag. With a bar focused, arrow keys move it and **Shift + arrow** adjusts the end. Undated records show **Set dates**; milestones appear as diamonds.

## Expected result {#expected-result}

You can view the same records as a table or a filtered view and explain a calculated task date.

## If something goes wrong {#troubleshooting}

An empty view may simply have a restrictive filter. Check dates, statuses and dependencies before recreating records. Creation and modification dates are maintained by Gnosi and are not editable planning dates.

## Related guides {#related-guides}

- [Create pages, links and attachments](pages-files.md)
- [Enable plugins, connect services and automate](integrations-automations.md)
