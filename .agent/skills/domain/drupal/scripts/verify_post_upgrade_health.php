<?php

declare(strict_types=1);

use Drupal\Core\Site\Settings;
use Drupal\webform\Utility\WebformYaml;

$targets = [
  'ai_chatbot',
  'ai_content_suggestions',
  'ai_logging',
  'contact_block',
  'contact',
  'history',
  'smtp',
];
$enabled_targets = array_values(array_filter(
  $targets,
  static fn(string $module): bool => \Drupal::moduleHandler()->moduleExists($module),
));

$webform = \Drupal\webform\Entity\Webform::load('contact');
if (!$webform) {
  throw new RuntimeException('The migrated contact Webform is missing.');
}
$handlers = 0;
foreach ($webform->getHandlers() as $handler) {
  if ($handler->isEnabled() && $handler->getPluginId() === 'email') {
    $handlers++;
  }
}

$translation_expectations = [
  'language.es' => ['/es/politica-de-privacidad', 'Enviar mensaje'],
  'language.en-gb' => ['/en/privacy-policy', 'Send message'],
];
$translations = [];
$storage = \Drupal::service('config.storage');
foreach ($translation_expectations as $collection_name => [$link, $submit]) {
  $data = $storage->createCollection($collection_name)
    ->read('webform.webform.contact');
  $elements = WebformYaml::decode($data['elements'] ?? '');
  $translations[$collection_name] = [
    'privacy_link' => $elements['privacy_policy']['#terms_link'] ?? NULL,
    'submit' => $elements['actions']['#submit__label'] ?? NULL,
  ];
}

$contact_links = [];
foreach (\Drupal::entityTypeManager()->getStorage('menu_link_content')->loadMultiple() as $menu_link) {
  foreach ($menu_link->getTranslationLanguages() as $langcode => $language) {
    $translation = $menu_link->getTranslation($langcode);
    $uri = (string) ($translation->get('link')->first()?->get('uri')->getValue() ?? '');
    if ($uri === 'internal:/form/contact') {
      $contact_links[$langcode] = $uri;
    }
  }
}

$behind_jobs = [];
foreach (\Drupal::entityTypeManager()->getStorage('ultimate_cron_job')->loadMultiple() as $job) {
  if ($job->isBehindSchedule()) {
    $behind_jobs[] = $job->id();
  }
}

$groq_module_enabled = \Drupal::moduleHandler()->moduleExists('ai_provider_groq');
$groq_key_id = \Drupal::config('ai_provider_groq.settings')->get('api_key');
$groq_provider_usable = $groq_module_enabled
  ? \Drupal::service('ai.provider')->createInstance('groq')->isUsable()
  : FALSE;

$result = [
  'enabled_retired_modules' => $enabled_targets,
  'webform_open' => $webform->isOpen(),
  'webform_archived' => (bool) $webform->get('archive'),
  'email_handlers' => $handlers,
  'translations' => $translations,
  'contact_links' => $contact_links,
  'mail_interface' => \Drupal::config('system.mail')->get('interface.default'),
  'html5_validation' => Settings::get('enable_html5_validation'),
  'behind_cron_jobs' => $behind_jobs,
  'groq_module_enabled' => $groq_module_enabled,
  'groq_key_id' => $groq_key_id,
  'groq_provider_usable' => $groq_provider_usable,
];

$violations = [];
if ($enabled_targets) {
  $violations[] = 'retired modules remain enabled';
}
if (!$result['webform_open'] || $result['webform_archived'] || $handlers !== 2) {
  $violations[] = 'contact Webform state is invalid';
}
foreach ($translation_expectations as $collection_name => [$link, $submit]) {
  if ($translations[$collection_name] !== ['privacy_link' => $link, 'submit' => $submit]) {
    $violations[] = "contact translation is invalid: {$collection_name}";
  }
}
if (count($contact_links) !== 3 || array_values(array_unique($contact_links)) !== ['internal:/form/contact']) {
  $violations[] = 'translated contact menu links are invalid';
}
if ($result['mail_interface'] !== 'php_mail') {
  $violations[] = 'default mail interface is not php_mail';
}
if ($result['html5_validation'] !== FALSE) {
  $violations[] = 'HTML5 validation is not explicitly disabled';
}
if ($behind_jobs) {
  $violations[] = 'Ultimate Cron jobs remain behind schedule';
}
if (!$groq_module_enabled || $groq_key_id !== 'ai_agent' || !$groq_provider_usable) {
  $violations[] = 'Groq provider configuration is incomplete';
}
if ($violations) {
  throw new RuntimeException(implode('; ', $violations));
}

print json_encode($result, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT) . PHP_EOL;
