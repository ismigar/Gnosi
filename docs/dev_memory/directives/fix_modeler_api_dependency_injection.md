# DIRECTIVE: FIX_MODELER_API_DI_ERROR

> ID: 2026-03-12_MODELER_API_FIX
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/fix_modeler_api.py 
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Resolve a fatal TypeError in Drupal production where `Drupal\modeler_api\Api::__construct()` receives `EntityTypeManager` instead of `MenuLinkManagerInterface` at argument #6.
- **Success Criteria:** The remote Drupal site passes `drush cr` without throwing a ServiceNotFoundException or TypeError, and the site functions correctly.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Environment Variables (.env_shared):**
  - `SSH_HOST`, `SSH_USER`, `SSH_KEY_PATH`, `SSH_SUWEB_PASSWORD`, `DRUPAL_PATH`

### Outputs
- **Console Output:** Success message after reading and then patching the remote files.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Connect to the remote server using `DrupalRemoteAgent`.
2. **Acquisition:** Read `web/modules/contrib/modeler_api/src/Api.php` and `web/modules/contrib/modeler_api/modeler_api.services.yml`.
3. **Processing:** Identify the mismatch in constructor arguments between the PHP file and the service definition container.
4. **Patching:** Generate a shell command or script step to rewrite the remote file correctly.
5. **Verification:** Run `drush cr` on the remote server and ensure the error disappears.

## 4. Tools and Libraries

- **Python libraries:** `pexpect` (via `DrupalRemoteAgent`).

## 5. Restrictions and Edge Cases

- Modifications must be done inside the `webapps/web` path.
- Contrib modules might be overwritten by `composer update` in the future. We should evaluate if this needs a formal patch, but for now we deploy a hotfix inline.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 12/03 | TypeError argument 6 | Mismatch between services.yml and __construct | [TBD] |

## 7. Pre-Execution Checklist

- [x] Create this directive.
- [ ] Implement and run Python script.
