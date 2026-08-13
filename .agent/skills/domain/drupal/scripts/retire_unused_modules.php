<?php

declare(strict_types=1);

const RETIRED_MODULES = [
  'n8n_helper',
  'notion_bridge',
];

$module_handler = \Drupal::moduleHandler();
$enabled_modules = array_values(array_filter(
  RETIRED_MODULES,
  static fn(string $module): bool => $module_handler->moduleExists($module),
));

if ($enabled_modules !== []) {
  $uninstalled = \Drupal::service('module_installer')->uninstall($enabled_modules);
  if (!$uninstalled) {
    throw new RuntimeException('Drupal could not uninstall the retired modules.');
  }
}

$module_handler = \Drupal::moduleHandler();
$still_enabled = array_values(array_filter(
  RETIRED_MODULES,
  static fn(string $module): bool => $module_handler->moduleExists($module),
));
if ($still_enabled !== []) {
  throw new RuntimeException(sprintf(
    'Retired modules remain enabled: %s',
    implode(', ', $still_enabled),
  ));
}

print sprintf(
  "Module retirement complete: uninstalled=%s\n",
  $enabled_modules === [] ? 'none' : implode(',', $enabled_modules),
);
