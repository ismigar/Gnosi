<?php

declare(strict_types=1);

use Drupal\Core\Entity\EntityInterface;
use Drupal\webform\Utility\WebformYaml;

/**
 * Add or update the privacy-policy agreement in a Webform element array.
 */
function temenos_ensure_privacy_element(
  array $elements,
  string $title,
  string $link,
): array {
  $actions = $elements['actions'] ?? NULL;
  unset($elements['actions']);
  $elements['privacy_policy'] = [
    '#type' => 'webform_terms_of_service',
    '#title' => $title,
    '#terms_type' => 'link',
    '#terms_link' => $link,
    '#terms_link_target' => '',
    '#required' => TRUE,
  ];
  if ($actions !== NULL) {
    $elements['actions'] = $actions;
  }
  return $elements;
}

/**
 * Translate the visible labels of the small contact Webform.
 */
function temenos_translate_contact_elements(
  array $elements,
  array $labels,
  string $privacy_title,
  string $privacy_link,
): array {
  foreach (['name', 'email', 'subject', 'message'] as $element_key) {
    if (!isset($elements[$element_key])) {
      throw new RuntimeException("Required contact element is missing: {$element_key}");
    }
    $elements[$element_key]['#title'] = $labels[$element_key];
  }
  if (!isset($elements['actions'])) {
    throw new RuntimeException('Required contact actions element is missing.');
  }
  $elements['actions']['#title'] = $labels['actions'];
  $elements['actions']['#submit__label'] = $labels['submit'];
  return temenos_ensure_privacy_element($elements, $privacy_title, $privacy_link);
}

/**
 * Update every translation of a content menu link without changing its title.
 */
function temenos_update_menu_link(EntityInterface $link, string $uri): void {
  foreach ($link->getTranslationLanguages() as $langcode => $language) {
    $translation = $link->getTranslation($langcode);
    $value = $translation->get('link')->first()?->getValue() ?? [];
    $value['uri'] = $uri;
    $translation->set('link', $value);
  }
  $link->save();
}

$module_handler = \Drupal::moduleHandler();
foreach (['webform', 'menu_link_content'] as $required_module) {
  if (!$module_handler->moduleExists($required_module)) {
    throw new RuntimeException("Required module is not enabled: {$required_module}");
  }
}

$entity_type_manager = \Drupal::entityTypeManager();
$webform = $entity_type_manager->getStorage('webform')->load('contact');
if (!$webform) {
  throw new RuntimeException('The existing contact Webform is missing.');
}

$enabled_handlers = 0;
foreach ($webform->getHandlers() as $handler) {
  if ($handler->isEnabled() && $handler->getPluginId() === 'email') {
    $enabled_handlers++;
  }
}
if ($enabled_handlers < 2) {
  throw new RuntimeException('The contact Webform must retain two enabled email handlers.');
}

if ($entity_type_manager->hasDefinition('ai_log')) {
  $ai_log_count = (int) $entity_type_manager->getStorage('ai_log')
    ->getQuery()
    ->accessCheck(FALSE)
    ->count()
    ->execute();
  if ($ai_log_count !== 0) {
    throw new RuntimeException('AI log entities exist; refusing to uninstall AI Logging.');
  }
}

if ($entity_type_manager->hasDefinition('ai_assistant')) {
  $assistant_count = (int) $entity_type_manager->getStorage('ai_assistant')
    ->getQuery()
    ->accessCheck(FALSE)
    ->count()
    ->execute();
  if ($assistant_count !== 0) {
    throw new RuntimeException('AI assistants exist; refusing to uninstall AI Chatbot.');
  }
}

foreach ($entity_type_manager->getStorage('block')->loadMultiple() as $block) {
  if (in_array($block->getPluginId(), ['ai_chatbot_block', 'ai_deepchat_block'], TRUE)) {
    throw new RuntimeException('An AI chatbot block is placed; refusing to uninstall AI Chatbot.');
  }
}

$webform->setElements(temenos_translate_contact_elements(
  $webform->getElementsDecoded(),
  [
    'name' => 'El teu nom',
    'email' => 'El teu correu electrònic',
    'subject' => 'Assumpte',
    'message' => 'Missatge',
    'actions' => "Botó d'enviament",
    'submit' => 'Envia el missatge',
  ],
  'Accepto la {política de privacitat}.',
  '/ca/politica-de-privacitat',
));
$webform->set('archive', FALSE);
$webform->setStatus(TRUE);
$webform->save();

$translation_elements = [
  'language.en-gb' => [
    'labels' => [
      'name' => 'Your name',
      'email' => 'Your email',
      'subject' => 'Subject',
      'message' => 'Message',
      'actions' => 'Submit button',
      'submit' => 'Send message',
    ],
    'privacy_title' => 'I accept the {privacy policy}.',
    'privacy_link' => '/en/privacy-policy',
  ],
  'language.es' => [
    'labels' => [
      'name' => 'Tu nombre',
      'email' => 'Tu correo electrónico',
      'subject' => 'Asunto',
      'message' => 'Mensaje',
      'actions' => 'Botón de envío',
      'submit' => 'Enviar mensaje',
    ],
    'privacy_title' => 'Acepto la {política de privacidad}.',
    'privacy_link' => '/es/politica-de-privacidad',
  ],
];
$config_storage = \Drupal::service('config.storage');
foreach ($translation_elements as $collection_name => $translation) {
  $collection = $config_storage->createCollection($collection_name);
  $data = $collection->read('webform.webform.contact') ?: [];
  $data['elements'] = WebformYaml::encode(temenos_translate_contact_elements(
    $webform->getElementsDecoded(),
    $translation['labels'],
    $translation['privacy_title'],
    $translation['privacy_link'],
  ));
  $collection->write('webform.webform.contact', $data);
}

$contact_links = [];
foreach ($entity_type_manager->getStorage('menu_link_content')->loadMultiple() as $link) {
  foreach ($link->getTranslationLanguages() as $langcode => $language) {
    $translation = $link->getTranslation($langcode);
    $uri = (string) ($translation->get('link')->first()?->get('uri')->getValue() ?? '');
    if (in_array($uri, ['internal:/contact', 'internal:/form/contact'], TRUE)) {
      $contact_links[$link->id()] = $link;
      break;
    }
  }
}
if (!$contact_links) {
  throw new RuntimeException('The public Contacta menu link was not found.');
}
foreach ($contact_links as $link) {
  temenos_update_menu_link($link, 'internal:/form/contact');
}

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
if ($enabled_targets && !\Drupal::service('module_installer')->uninstall($enabled_targets)) {
  throw new RuntimeException('One or more obsolete modules could not be uninstalled.');
}

$mail_config = \Drupal::configFactory()->getEditable('system.mail');
$mail_interface = $mail_config->get('interface.default');
if ($mail_interface === 'SMTPMailSystem' && !$module_handler->moduleExists('smtp')) {
  $mail_config->set('interface.default', 'php_mail')->save(TRUE);
  $mail_interface = 'php_mail';
}
if ($mail_interface !== 'php_mail') {
  throw new RuntimeException("Unexpected default mail interface after SMTP removal: {$mail_interface}");
}

\Drupal::service('config.factory')->reset();
print json_encode([
  'webform' => $webform->id(),
  'webform_open' => $webform->isOpen(),
  'email_handlers' => $enabled_handlers,
  'menu_links_migrated' => count($contact_links),
  'modules_uninstalled' => $enabled_targets,
  'mail_interface' => $mail_interface,
], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT) . PHP_EOL;
