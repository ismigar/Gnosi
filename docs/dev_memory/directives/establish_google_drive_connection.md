# Standard Operating Procedure: Google Drive Connection

# DIRECTIVE: [GOOGLE_DRIVE_CONNECTION]

> ID: 20260130-GDRIVE
> Associated Script: scripts/google_drive_connector.py
> Last Update: 2026-01-30
> Status: ACTIVE

---

## 1. Objectives and Scope

*Establish a reliable, authenticated connection to Google Drive for file management within the Gnosi ecosystem.*

- **Main Objective:** Authenticate against Google Drive API using a Service Account and perform basic file operations (List, Upload, Download).
- **Success Criteria:** The script successfully lists files from a specific shared folder without authentication errors.

## 2. Input/Output (I/O) Specifications

*Strictly define data types to ensure determinism.*

### Inputs

- **Environment Variables (.env.shared):**
    - `GOOGLE_SERVICE_ACCOUNT_JSON`: Absolute path to the Service Account JSON key file.
    - `GOOGLE_DRIVE_ROOT_FOLDER_ID`: (Optional) ID of the root folder to operate within.
- **Dependencies:**
    - `google-api-python-client`
    - `google-auth`

### Outputs

- **Console Output:** 
    - Success: JSON object with "status": "ok" and a list of files.
    - Failure: JSON object with "status": "error" and detailed message.

## 3. Logical Flow (Algorithm)

*DO NOT write code here. Describe the logic step by step.*

1. **Initialization:** Load `GOOGLE_SERVICE_ACCOUNT_JSON` from environment. Check if file exists.
2. **Authentication:** Create credentials object from the JSON file using `google.oauth2.service_account`.
3. **Service Build:** Build the Drive v3 service object.
4. **Validation:** Perform a lightweight API call (e.g., `files().list(pageSize=1)`).
5. **Operation:** Execute the requested operation (List/Upload/etc.).
6. **Error Handling:** Catch `HttpError` and return structured JSON error.

## 4. Tools and Libraries

*Whitelist of allowed dependencies.*

- **Python libraries:** `google-api-python-client`, `google-auth`.
- **API:** Google Drive API v3.

## 5. Restrictions and Edge Cases

*Known conditions that could break the standard flow.*

- **Service Account Access:** The Service Account DOES NOT have access to the user's Drive by default. **The user must explicitly share the target folder(s) with the Service Account's email address.**
- **Quotas:** Google Drive API has usage limits. Scripts should handle 403 Rate Limit Exceeded with exponential backoff.
- **Security:** Never commit the JSON key to Git. It must be gitignored.

## 6. Error Protocol and Learning (Live Memory)

*CRITICAL: This section is automatically updated after failures.*

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

```bash
# Test connection
python pipeline/sandbox/test_drive_connection.py
```

## 8. Pre-Execution Checklist

- [ ]  `GOOGLE_SERVICE_ACCOUNT_JSON` is requested and path is valid in `.env.shared`.
- [ ]  Service Account Email is added to the shared folder in Google Drive.
- [ ]  Google Drive API is enabled in the GCP Project.

## 9. Post-Execution Checklist

- [ ]  Connection verified.
- [ ]  Script cleans up any temporary files.
