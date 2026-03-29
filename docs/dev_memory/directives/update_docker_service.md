# DIRECTIVE: UPDATE_DOCKER_SERVICE

> ID: OPS_Upd_001
> Associated Script: scripts/update_docker_image.py (Generic placeholder)
> Last Update: 2026-01-31
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Update the Docker image version of a running service (e.g., n8n, frontend) to a newer stable release.
- **Success Criteria:** The service is defined with the new image tag in `docker-compose.yml` and the user is notified to restart.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Service Name:** [e.g., n8n]
- **Target File:** [Path to docker-compose.yml]
- **New Image Tag:** [e.g., docker.n8n.io/n8nio/n8n:2.4.8]

### Outputs

- **Modified File:** Updated `docker-compose.yml`.

## 3. Logical Flow (Algorithm)

1.  **Identify:** Locate the correctly `docker-compose.yml` and service definition.
2.  **Backup (Optional but recommended):** Ensure volume mapping is persistent (checked).
3.  **Update:** Replace the `image` line with the new tag.
4.  **Notify:** Inform the user to run `docker-compose pull && docker-compose up -d`.

## 4. Tools and Libraries

- **Tools:** `replace_file_content` or manual edit via agent.

## 5. Restrictions and Edge Cases

- **Major Versions:** Moving from v1 to v2 may have breaking changes. User should be warned (Done).
- **Persistence:** Ensure `/home/node/.n8n` is mounted to host or volume to avoid data loss.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 31/01 | N/A | Initial creation | N/A |
| 31/01 | Docker Daemon Freeze | `docker ps` hangs indefintely. Update process > 1h. | **Detection:** If `docker ps` times out. **Action:** Do NOT retry. Advise User to restart Docker Desktop manually immediately. Agent cannot reset Daemon on Mac. |
