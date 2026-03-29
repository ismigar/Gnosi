# Directive: Manage macOS Startup Items

> ID: manage_macos_startup_items
> Associated Script: scripts/manage_startup_item.py (Generic capability)
> Last Update: 2026-02-10
> Status: ACTIVE

---

## 1. Objectives and Scope

*Safely remove or disable macOS startup items (LaunchAgents/LaunchDaemons).*

- **Main Objective:** Enable/Disable specific services or Login Items from starting automatically.
- **Success Criteria:** The service or app is successfully added/removed from login items or LaunchAgents.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Service Label:** `[string]` (e.g., `com.ollama.ollama`).
- **Target Domain:** `[string]` (e.g., `gui/501` for user agents, check `id -u`).

### Outputs

- **Console Output:** Success message indicating the item's state change.

## 3. Logical Flow (Algorithm)

1. **Identification:** Check if it's a LaunchAgent/Daemon or a Login Item (App).
2. **Action - Remove:**
    a. Launchctl disable/bootout (for services).
    b. AppleScript `delete login item` (for apps).
3. **Action - Add:**
    a. Create plist (for services).
    b. AppleScript `make login item` (for apps).
4. **Action - List:** Show current status.

## 4. Tools and Libraries

- **Python libraries:** `subprocess`, `os`.
- **System tools:** `launchctl`, `id`.

## 5. Restrictions and Edge Cases

- **SIP (System Integrity Protection):** System services cannot be disabled.
- **Domain:** User agents run in `gui/<uid>`, daemons in `system`. Identifying the correct domain is crucial.
- **Legacy behavior:** `launchctl remove` vs `bootout`. `bootout` is preferred on modern macOS.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 2026-02-10 | Persistence after disable | App running from .Trash | Force kill processes (`pkill -f`) and advise emptying Trash |

## 7. Examples of Use

```bash
python scripts/manage_startup_item.py --service com.ollama.ollama --action remove
```
