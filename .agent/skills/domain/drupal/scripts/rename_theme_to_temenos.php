<?php

declare(strict_types=1);

const SOURCE_THEME = 'elraco';
const TARGET_THEME = 'temenos';

/**
 * Replace only exact theme names and breakpoint identifiers recursively.
 */
function replace_theme_references(mixed $value): mixed {
  if (is_array($value)) {
    foreach ($value as $key => $item) {
      $value[$key] = replace_theme_references($item);
    }
    return $value;
  }

  if (!is_string($value)) {
    return $value;
  }
  if ($value === SOURCE_THEME) {
    return TARGET_THEME;
  }
  if (str_starts_with($value, SOURCE_THEME . '.')) {
    return TARGET_THEME . substr($value, strlen(SOURCE_THEME));
  }
  return $value;
}

/**
 * Copy custom theme settings without copying the source config hash.
 */
function migrate_theme_settings(): bool {
  $config_factory = \Drupal::configFactory();
  $source = $config_factory->get(SOURCE_THEME . '.settings');
  if ($source->isNew()) {
    return FALSE;
  }

  $target = $config_factory->getEditable(TARGET_THEME . '.settings');
  foreach ($source->getRawData() as $key => $value) {
    if ($key !== '_core') {
      $target->set($key, $value);
    }
  }
  $target->save(TRUE);
  return TRUE;
}

/**
 * Clone source-theme block placements to target-theme configuration entities.
 */
function migrate_theme_blocks(): int {
  $storage = \Drupal::entityTypeManager()->getStorage('block');
  $source_blocks = $storage->loadByProperties(['theme' => SOURCE_THEME]);
  $created = 0;

  foreach ($source_blocks as $source_block) {
    $source_id = $source_block->id();
    $target_id = str_starts_with($source_id, SOURCE_THEME . '_')
      ? TARGET_THEME . substr($source_id, strlen(SOURCE_THEME))
      : TARGET_THEME . '_' . $source_id;
    if ($storage->load($target_id)) {
      continue;
    }

    $values = $source_block->toArray();
    unset($values['uuid']);
    $values['id'] = $target_id;
    $values['theme'] = TARGET_THEME;
    $storage->create($values)->save();
    $created++;
  }

  return $created;
}

/**
 * Update responsive-image theme dependencies and breakpoint identifiers.
 */
function migrate_responsive_image_configuration(): int {
  $storage = \Drupal::service('config.storage');
  $config_factory = \Drupal::configFactory();
  $updated = 0;

  foreach ($storage->listAll('responsive_image.styles.') as $config_name) {
    $config = $config_factory->getEditable($config_name);
    $current = $config->getRawData();
    $migrated = replace_theme_references($current);
    if ($migrated === $current) {
      continue;
    }
    foreach (array_keys($current) as $key) {
      $config->clear($key);
    }
    foreach ($migrated as $key => $value) {
      $config->set($key, $value);
    }
    $config->save(TRUE);
    $updated++;
  }

  return $updated;
}

$theme_list = \Drupal::service('extension.list.theme');
$theme_list->reset();
$available_themes = $theme_list->getList();
if (!isset($available_themes[TARGET_THEME])) {
  throw new RuntimeException('The temenos theme code is not available.');
}

$theme_installer = \Drupal::service('theme_installer');
$theme_installer->install([TARGET_THEME]);

$settings_migrated = migrate_theme_settings();
$blocks_created = migrate_theme_blocks();
$responsive_styles_updated = migrate_responsive_image_configuration();

$system_theme = \Drupal::configFactory()->getEditable('system.theme');
$system_theme->set('default', TARGET_THEME)->save(TRUE);

$theme_list->reset();
$installed_themes = \Drupal::service('theme_handler')->listInfo();
if (isset($installed_themes[SOURCE_THEME])) {
  $theme_installer->uninstall([SOURCE_THEME]);
}

print sprintf(
  "Theme migration complete: settings=%s blocks_created=%d responsive_styles=%d default=%s\n",
  $settings_migrated ? 'migrated' : 'not-found',
  $blocks_created,
  $responsive_styles_updated,
  TARGET_THEME,
);
