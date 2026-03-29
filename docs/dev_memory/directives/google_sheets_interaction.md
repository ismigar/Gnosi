# Standard Operating Procedure: Google Sheets Interaction

# DIRECTIVE: [GOOGLE_SHEETS_INTERACTION]

> ID: 20260130-GSHEETS
> Associated Script: scripts/google_sheets_manager.py
> Last Update: 2026-01-30
> Status: ACTIVE

---

## 1. Objectives and Scope

*Manage Google Sheets documents: Create, Read, Update, and Append data.*

- **Main Objective:** Create spreadsheets with specific structures and manage data rows.
- **Success Criteria:** Spreadsheet exists in the correct folder, headers are correct, and data can be read/written.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Environment Variables (.env.shared):**
    - `GOOGLE_SERVICE_ACCOUNT_JSON`: Path to credentials.
    - `GOOGLE_DRIVE_ROOT_FOLDER_ID`: Parent folder ID.
- **Dependencies:**
    - `google-api-python-client`
    - `google-auth`

### Outputs

- **Console Output:** 
    - JSON with `spreadsheetId`, `spreadsheetUrl`, and operation status.

## 3. Logical Flow (Algorithm)

1. **Auth:** Authenticate using Service Account (Scopes: Drive + Sheets).
2. **Creation:** Use `service.spreadsheets().create()` to generate the file.
3. **Move:** Created files appear in "root" by default. Use Drive API to `update` the file: `addParents=[folder_id]`, `removeParents=[current_parents]`.
4. **Formatting:** Use `spreadsheets().values().update()` or `append()` to set headers or data.

## 4. Tools and Libraries

- `google-api-python-client`
- `google-auth`

## 5. Restrictions and Edge Cases

- **Cell Limits:** Google Sheets has a cell limit (10M).
- **Rate Limits:** 60 requests/min per user per project. Implement backoff if needed.
- **Dates:** Dates must be serial numbers or string formatted strings (ISO 8601 preferred).

## 6. Error Protocol

| Date | Error Detected | Solution |
| --- | --- | --- |

