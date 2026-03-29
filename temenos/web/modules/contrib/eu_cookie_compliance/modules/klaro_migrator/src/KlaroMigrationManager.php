<?php

namespace Drupal\klaro_migrator;

use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Access\AccessException;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Extension\ModuleInstallerInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Messenger\MessengerTrait;
use Drupal\Core\Url;

/**
 * Manages the migration from EUCC to Klaro.
 */
class KlaroMigrationManager {

  use MessengerTrait;

  /**
   * The configuration factory.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected $configFactory;

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The language manager service.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;

  /**
   * The module handler service.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * The module installer service.
   *
   * @var \Drupal\Core\Extension\ModuleInstallerInterface
   */
  protected $moduleInstaller;

  /**
   * Constructor.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The configuration factory service.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_manager
   *   The entity type manager.
   * @param \Drupal\Core\Language\LanguageManagerInterface $language_manager
   *    The language manager service.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *    The module handler service.
   * @param \Drupal\Core\Extension\ModuleInstallerInterface $module_installer
   *    The module installer service.
   */
  public function __construct(
    ConfigFactoryInterface $config_factory,
    EntityTypeManagerInterface $entity_manager,
    LanguageManagerInterface $language_manager,
    ModuleHandlerInterface $module_handler,
    ModuleInstallerInterface $module_installer
  ) {
    $this->configFactory = $config_factory;
    $this->entityTypeManager = $entity_manager;
    $this->languageManager = $language_manager;
    $this->moduleHandler = $module_handler;
    $this->moduleInstaller = $module_installer;
  }

  /**
   * Perform the migration from EUCC to Klaro.
   *
   * @return bool
   *   True, if the migration completed.
   *
   * @throws \Drupal\Core\Extension\ExtensionNameLengthException
   * @throws \Drupal\Core\Extension\ExtensionNameReservedException
   * @throws \Drupal\Core\Extension\MissingDependencyException
   */
  public function migrate() {

    $default_langcode = $this->languageManager->getDefaultLanguage()->getId();

    // Load EUCC settings.
    $eucc_settings = $this->configFactory->get('eu_cookie_compliance.settings')->getRawData();

    // Prepare Klaro settings and texts.
    $klaro_settings = $this->prepareKlaroSettings($eucc_settings);
    $klaro_texts = $this->prepareKlaroTexts($eucc_settings);

    // Save the settings to their respective configuration objects.
    $this->configFactory->getEditable('klaro.settings')
      ->merge($klaro_settings)
      ->save();

    // Save translations into the `klaro.texts` configuration for each language.
    foreach ($klaro_texts as $langcode => $translations) {
      if ($langcode === $default_langcode) {
        $editable_config = $this->configFactory->getEditable('klaro.texts');
      } else {
        // Other languages are saved under language overrides.
        $editable_config = $this->languageManager->getLanguageConfigOverride($langcode, 'klaro.texts');
      }
      $editable_config->merge($translations);
      $editable_config->save();
    }

    // Migrate EUCC categories to Klaro purposes.
    $this->migratePurposes();

    // Map permissions from EUCC to Klaro.
    $this->migratePermissions();

    // Return.
    return TRUE;
  }

  /**
   * Checks permissions to run the migrations.
   *
   * @throws \Drupal\Core\Access\AccessException
   *   Thrown if the permissions are not correct.
   *
   * @return void
   */
  public function checkMigratePermissions() {
    $account = \Drupal::currentUser();

    if (!$account->hasPermission('administer klaro')) {
      throw new AccessException('Klaro is already installed, but your user is missing the `administer klaro` permission.');
    } else if (!$account->hasPermission('administer modules')) {
      throw new AccessException('Klaro module is installed, but you do not have the `administer modules` permission.');
    }
  }

  /**
   * Prepare Klaro settings by mapping EUCC settings.
   *
   * @param array $eucc_settings
   *   The EU Cookie Compliance settings.
   *
   * @return array
   *   The transformed Klaro settings.
   */
  protected function prepareKlaroSettings(array $eucc_settings) {
    if ($eucc_settings['method'] === 'opt_out') {
      // The opt-out method is not easily replicable into Klaro, because there
      // is no global setting. We would need to set all service to opt-out.
      // Just present a message for now.
      $this->messenger()->addWarning('EUCC opt-out method is not directly supported by Klaro. You can manually set all Klaro services to "opt-out" to replicate the functionality.');
    }
    $data = [
      'accept_all' => $eucc_settings['enable_save_preferences_button'] ?? false,
      'dialog_mode' => $this->mapDialogMode($eucc_settings['method'] ?? 'notice'),
      'show_toggle_button' => ($eucc_settings['withdraw_enabled'] ?? 0) == 1 || ($eucc_settings['settings_tab_enabled'] ?? 0) == 1,
      'disable_urls' => array_filter(
        array_map(fn($path) => preg_quote(trim($path), '/'), explode("\n", $eucc_settings['exclude_paths'] ?? '')),
        fn($path) => $path !== ''
      ),
      'show_close_button' => ($eucc_settings['close_button_enabled'] && $eucc_settings['close_button_action'] === 'reject_all_cookies'),
      'library' => [
        'cookie_expires_after_days' => isset($eucc_settings['cookie_lifetime']) ? floor($eucc_settings['cookie_lifetime'] / 86400) : NULL,
        'cookie_domain' => $eucc_settings['domain'] ?? '',
        'cookie_name' => $eucc_settings['cookie_name'] ?? 'klaro',
        'hide_decline_all' => !empty($eucc_settings['reject_button_enabled']),
        'html_texts' => TRUE, // Always true, because EUCC texts are formatted texts.
      ],
    ];

    // If the dialog mode is notice, we can use the position style setting.
    if ($data['dialog_mode'] === 'notice') {
      if ($eucc_settings['popup_position']) {
        $data['styles'][] = 'light'; // Add light as well because it's Klaro default.
        $data['styles'][] = 'top';
      }
    }

    // Only store non-empty values to fall back to Klaro defaults if not data
    // from EUCC.
    $data = NestedArray::filter($data, function ($value) {
      // Remove NULL and empty strings, but keep false and 0.
      return $value !== null && $value !== '';
    });
    return $data;
  }

  /**
   * Prepare Klaro texts by mapping EUCC settings.
   *
   * @param array $eucc_settings
   *   The EU Cookie Compliance settings.
   *
   * @return array
   *   The transformed Klaro texts with translations.
   */
  protected function prepareKlaroTexts(array $eucc_settings) {
    // Load the default language and other configured languages.
    $languages = $this->languageManager->getLanguages();
    $default_langcode = $this->languageManager->getDefaultLanguage()->getId();

    $klaro_texts = [];

    // Iterate over all languages and retrieve configuration overrides.
    foreach ($languages as $langcode => $language) {
      // Load configuration for the specific language.
      $config = $this->configFactory->get('eu_cookie_compliance.settings')->getRawData();
      if ($langcode !== $default_langcode) {
        // Load language-specific overrides for the config.
        $override = $this->languageManager->getLanguageConfigOverride($language->getId(), 'eu_cookie_compliance.settings')->getRawData();
        $config = NestedArray::mergeDeep($config, $override);
      }

      // Map configuration to Klaro texts structure.
      $klaro_texts[$langcode] = [
        'consentModal' => [
          'privacyPolicy' => [
            'url' => !empty($config['popup_link'])
              ? $this->convertUrl($config['popup_link'])
              : '',
            'title' => $config['popup_more_info_button_message'] ?? '',
          ],
        ],
        'decline' => $config['disagree_button_label'] ?? $config['reject_button_label'] ?? '',
        'acceptAll' => $config['accept_all_categories_button_label'] ?? '',
        'acceptSelected' => $config['save_preferences_button_label'] ?? '',
        'consentNotice' => [
          'description' => $config['popup_info']['value'] ?? '',
        ],
      ];

      // Remove empty values to fallback to Klaro defaults.
      $klaro_texts[$langcode] = NestedArray::filter($klaro_texts[$langcode], function ($value) {
        return $value !== null && $value !== '';
      });
    }

    return $klaro_texts;
  }

  /**
   * Update roles with corresponding Klaro permissions.
   */
  protected function migratePermissions() {
    // Map old EUCC permissions to new Klaro permissions.
    $permission_map = [
      'display eu cookie compliance popup' => 'use klaro',
      'administer eu cookie compliance popup' => 'administer klaro',
    ];

    // Load existing roles.
    $role_storage = $this->entityTypeManager->getStorage('user_role');
    $roles = $role_storage->loadMultiple();

    // Iterate over each role and map the permissions.
    foreach ($roles as $role) {
      $has_changed = FALSE;
      foreach ($permission_map as $eucc_permission => $klaro_permission) {
        if ($role->hasPermission($eucc_permission)) {
          $role->grantPermission($klaro_permission);
          $has_changed = TRUE;
        }
      }

      // Save changes to the role.
      if ($has_changed) {
        $role->save();
      }
    }
  }

  /**
   * Convert a URL string to the expected format for Klaro.
   *
   * @param string $url
   *   The input URL string (e.g., "/node/123" or "https://example.com/node/555").
   *
   * @return string
   *   The transformed URL in "internal:/node/123" format, or untouched for external links.
   */
  protected function convertUrl(string $url): string {
    /** @var \Drupal\Core\Path\PathValidatorInterface $path_validator */
    $path_validator = \Drupal::service('path.validator');

    // Convert internal paths, so "/node/123" to "internal:/node/123".
    if (str_starts_with($url, '/') && $path_validator->isValid($url)) {
      return 'internal:' . $url;
    }

    try {
      // Check if URL is external and valid.
      $url_object = Url::fromUri($url);
      if ($url_object->isExternal()) {
        return $url; // Return the external URL as it is.
      }
    } catch (\InvalidArgumentException $e) {
      \Drupal::logger('eucc')
        ->warning('Failed to convert url @url: @Message', ['@url' => $url]);
    }

    // Fallback: Return the original URL as-is.
    return $url;
  }

  /**
   * Helper function to map EUCC `method` to Klaro's `dialog_mode`.
   */
  protected function mapDialogMode(string $eucc_method) {
    switch ($eucc_method) {
      case 'default':
        return 'silent';
      case 'opt_in':
        return 'notice_modal';
      case 'categories':
        return 'manager';
      default:
        return 'notice';
    }
  }

  /**
   * Migrate EUCC categories to Klaro purposes.
   *
   * @return void
   */
  protected function migratePurposes() {
    // Prepare purpose candidates by mapping categories.
    $purpose_candidates = $this->mapPurposes();

    // Load the existing Klaro purposes.
    $klaro_purpose_storage = $this->entityTypeManager->getStorage('klaro_purpose');
    $existing_purposes = $klaro_purpose_storage->loadMultiple();

    // Create a lookup of existing purposes by both ID and label.
    $existing_ids = array_map(fn($purpose) => $purpose->id(), $existing_purposes);
    $existing_labels = array_map(fn($purpose) => $purpose->label(), $existing_purposes);

    // Iterate through purpose candidates and create missing purposes.
    foreach ($purpose_candidates as $candidate) {
      $id = $candidate['id'];
      $label = $candidate['label'];

      // Check for existing purpose (by ID or label).
      if (in_array($id, $existing_ids) || in_array($label, $existing_labels)) {
        // Skip if this purpose already exists.
        continue;
      }

      // Create a new Klaro purpose configuration entity.
      $klaro_purpose = $klaro_purpose_storage->create([
        'id' => $id,
        'label' => $label,
        'weight' => $candidate['weight'],
      ]);

      // Save the new purpose.
      $klaro_purpose->save();
    }
  }

  /**
   * Map EUCC cookie categories to Klaro purposes.
   *
   * @return array
   *   The mapped Klaro purposes data.
   */
  protected function mapPurposes() {
    $klaro_purposes = [];

    // Load cookie categories.
    $categories = $this->entityTypeManager->getStorage('cookie_category')->loadMultiple();
    $weight = 0;

    foreach ($categories as $category) {
      $klaro_purposes[] = [
        'id' => $category->id(),
        'label' => $category->label(),
        'weight' => $weight++,
      ];
    }

    return $klaro_purposes;
  }
}
