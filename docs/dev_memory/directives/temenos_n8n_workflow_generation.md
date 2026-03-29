# DIRECTIVE: TEMENOS_N8N_WORKFLOW_GENERATION

> ID: TEMENOS_GEN_001
> Associated Script: scripts/generate_temenos_workflow.py
> Last Update: 2026-01-31
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Generate the JSON configuration for a n8n workflow that automates the dissemination of "Temenos" content across multiple social media platforms (LinkedIn, Mastodon, Telegram, Facebook, Bluesky).
- **Success Criteria:** A valid n8n JSON file is created in `monorepo/apps/digital-brain/pipeline/sandbox/temenos_workflow.json` which includes all requested nodes and logic.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Notion Database ID:** `ebe282f0a2e145afbd76cd2036b37882` (XXSS).
- **Environment Variables** (in `.env.shared`):
    - `TEMENOS_NOTION_CRED_ID`
    - `TEMENOS_DATABASE_ID`
    - `TEMENOS_GROQ_CRED_ID`
    - `TEMENOS_LINKEDIN_CRED_ID` & `TEMENOS_LINKEDIN_ORG`
    - `TEMENOS_TELEGRAM_CRED_ID` & `TEMENOS_TELEGRAM_CHAT_ID`
    - `TEMENOS_FACEBOOK_CRED_ID`
    - `TEMENOS_BLUESKY_CRED_ID`
    - `TEMENOS_MASTODON_CRED_ID` (Manual check required)

### Outputs

- **Generated Artifacts:**
    - `monorepo/apps/digital-brain/pipeline/sandbox/temenos_workflow.json`: The n8n workflow JSON.

## 3. Logical Flow (Algorithm)

1.  **Define Trigger:**
    -   **Node:** Notion Trigger.
    -   **Event:** Page Updated/Created.
    -   **Filter:** Database "XXSS", Property "Estat" == "Pendent".

2.  **Define Content Extraction:**
    -   **Node:** IF / Switch.
    -   **Condition:** Check if "Context" (or `Resum/Excerpt`) is empty.
    -   **True (Empty):** HTTP Request (GET) to `URL_Temenos` -> **Code Node** (Custom JS to strip HTML/Convert to Markdown).
    -   **False (Has Text):** Use "Context" directly.

3.  **Define AI Processing:**
    -   **Node:** AI Agent / LLM Chain (Groq Model: Llama 3.3 70b).
    -   **Prompt:**
        -   Tone: Authentic, reflective, no hype, focus on common good.
        -   Tasks: Generate 5 outputs:
            1.  LinkedIn: Bilingual (ES/EN) + Summary + URL.
            2.  Mastodon: Catalan + Ethical Hashtags.
            3.  Telegram: Direct/Personal in Catalan.
            4.  Facebook: Informative in Spanish.
            5.  Bluesky: Synthetic (ES/EN).
    -   **Output Parser:** JSON Output (5 fields).

4.  **Define Output Channels:**
    -   **LinkedIn:** Native Node (`n8n-nodes-base.linkedIn`).
    -   **Mastodon:** HTTP Request Node (POST to `/api/v1/statuses`) as native node is missing.
    -   **Telegram:** Native Node (`n8n-nodes-base.telegram`).
    -   **Facebook:** Facebook Graph API Node (`n8n-nodes-base.facebookGraphApi`).
    -   **Bluesky:** HTTP Request (POST) to AT Protocol (`com.atproto.repo.createRecord`).

5.  **Define Closure:**
    -   **Node:** Notion Update.
    -   **Action:** Set "Estat" to "Publicat".
    -   **Action:** Set "Data Difusió" (if exists) or append to body.

6.  **Construction:**
    -   Assemble nodes and connections into the standard n8n JSON format.

## 4. Tools and Libraries

- **Python libraries:** `json`, `uuid` (for node IDs).

## 5. Restrictions and Edge Cases

- **Field Names:** Ensure Notion properties match the DB schema (`URL_Temenos`, `Estat`, `Resum/Excerpt`).
- **Bluesky Auth:** The workflow will need a pre-authenticated credential or HTTP Request with specific headers. We will generate the HTTP Request node template.
- **Error Handling:** Facebook node should have "Continue On Fail" enabled.
- **Node Availability:** The native `htmlToMarkdown` node is not available. Use a `Code` node with Regex/JS for basic cleaning.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 31/01 | Initial | N/A | Initial Draft |
| 31/01 | Node Not Found | `n8n-nodes-base.htmlToMarkdown` does not exist in user's n8n. | Replaced with `n8n-nodes-base.code` using JS Regex. |

## 7. Examples of Use

```bash
python monorepo/apps/digital-brain/pipeline/sandbox/generate_temenos_workflow.py
```
