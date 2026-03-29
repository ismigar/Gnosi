# Directive: Fix Drupal Entity Schema Errors

## Problem Description
Drupal reports "Mismatched entity and/or field definitions" in the status report. Specifically: "The node.layout_builder__translation field needs to be uninstalled."

## SOP: Diagnosis
1. **Check Status**: Run `drush status` to ensure the site is reachable.
2. **Entity Updates Status**: Run `drush st` (Status Report) or check the output of entity updates if `devel_entity_updates` is installed.
3. **Module List**: Check if `layout_builder`, `layout_builder_st`, or `layout_library` are installed.
    - `drush pm:list --status=enabled | grep layout`

## SOP: Execution
1. **Standard Updates**: Run `drush updb -y` and `drush cr`.
2. **Entity Updates (Modern Drupal)**:
    - If the error persists, it means the schema in the database doesn't match the entity definitions in code.
    - **CAUTION**: Directly modifying the `entity.definitions.bundle_field_map` or `entity.definitions.installed` in the `state` table or `key_value` table is dangerous.
    - **Step 1**: Use `drush devel-entity-updates` (if the `devel_entity_updates` module is installed).
    - **Step 2**: If not installed, consider installing it temporarily: `composer require drupal/devel_entity_updates; drush en devel_entity_updates -y; drush entup -y`.
    - **Step 3**: If it's a specific field that needs to be "uninstalled" and Drupal isn't doing it automatically, it might be due to leftover configuration.

## SOP: Specific Fix for `node.layout_builder__translation`
This field is often added by `layout_builder_st`. If the module is gone but the field remains:
1. Verify if the field exists in the `node_field_data` or a dedicated table.
2. Use a PHP script via `drush php:eval` to manually remove the field definition from the entity type manager if it's stuck.

```php
$entity_type_id = 'node';
$field_name = 'layout_builder__translation';
$entity_definition_update_manager = \Drupal::entityDefinitionUpdateManager();
$storage_definition = $entity_definition_update_manager->getFieldStorageDefinition($field_name, $entity_type_id);
if ($storage_definition) {
  $entity_definition_update_manager->uninstallFieldStorageDefinition($storage_definition);
}
```

## Verification
1. Run `drush cr`.
2. Check `drush st` for any remaining "Mismatched entity" warnings.
