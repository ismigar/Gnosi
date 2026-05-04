<?php

namespace Drupal\vault_migration\Form;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\vault_migration\VaultClient;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\vault_migration\ConfigManager;

/**
 * Configuration form for the Vault Bridge module.
 *
 * Allows administrators to configure API connection and database mapping
 * between Vault and Drupal content types.
 */
class VaultMigrationConfigForm extends FormBase {

  /**
   * The Vault client service.
   *
   * Handles API interaction with Vault.
   *
   * @var \Drupal\vault_migration\VaultClient
   */
  protected VaultClient $vaultClient;

  /**
   * The entity type manager service.
   *
   * Used to load Drupal entity definitions.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The entity field manager service.
   *
   * Used to retrieve field definitions for entities.
   *
   * @var \Drupal\Core\Entity\EntityFieldManagerInterface
   */
  protected EntityFieldManagerInterface $entityFieldManager;

  /**
   * The configuration manager for the Vault bridge.
   *
   * Encapsulates config read/write logic and helpers.
   *
   * @var \Drupal\vault_migration\ConfigManager
   */
  protected ConfigManager $configManager;

  /**
   * Class constructor.
   *
   * @param \Drupal\vault_migration\VaultClient $vaultClient
   *   The Vault API client service.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager service.
   * @param \Drupal\Core\Entity\EntityFieldManagerInterface $entityFieldManager
   *   The entity field manager service.
   * @param \Drupal\vault_migration\ConfigManager $configManager
   *   The configuration manager for Vault Bridge.
   */
  public function __construct(
    VaultClient $vaultClient,
    EntityTypeManagerInterface $entityTypeManager,
    EntityFieldManagerInterface $entityFieldManager,
    ConfigManager $configManager
  ) {
    $this->vaultClient = $vaultClient;
    $this->entityTypeManager = $entityTypeManager;
    $this->entityFieldManager = $entityFieldManager;
    $this->configManager = $configManager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('vault_migration.vault_client'),
      $container->get('entity_type.manager'),
      $container->get('entity_field.manager'),
      $container->get('vault_migration.config_manager')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'vault_migration_settings_form';
  }

  /**
   * Builds the configuration form for the Vault Bridge module.
   *
   * Allows the user to input an API key, load Vault databases, and map
   * them to Drupal content types and fields.
   *
   * @param array $form
   *   The initial form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   *
   * @return array
   *   The built form array.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $api_key = $this->vaultClient->getVaultApiKey();
    $config = $this->configManager->get();

    $form = $this->buildApiKeyField($form, $api_key);
    $form = $this->buildLoadDataBasesButton($form);

    // AJAX wrapper around the entire form.
    $form['#prefix'] = '<div id="vault-migration-wrapper">';
    $form['#suffix'] = '</div>';

    if (!empty($api_key)) {
      try {
        $databases = $this->vaultClient->searchDatabases();
        foreach ($databases as $db) {
          $form = $this->buildDatabaseSection($form, $form_state, $db, $config);
        }
      }
      catch (\Exception $e) {
        $this->messenger()->addWarning($this->t('Failed to load databases list.'));
      }
    }

    $form = $this->buildGlobalSettings($form);
    $form = $this->addSubmitButton($form);

    return $form;
  }

  /**
   * Builds the API key input field.
   *
   * @param array $form
   *   The existing form array.
   * @param string $api_key
   *   The current API key value to prepopulate the field.
   *
   * @return array
   *   The updated form array with the API key field.
   */
  private function buildApiKeyField(array $form, string $api_key): array {
    $form['api_key_wrapper'] = [
      '#type' => 'container',
      '#attributes' => [
        'class' => ['form-element--api-textfield'],
      ],
    ];

    $form['api_key_wrapper']['help'] = [
      '#type' => 'markup',
      '#markup' => $this->t(
        '<p><strong>Note:</strong> The Vault API Key is not stored in the Drupal configuration database for security reasons.</p>
         <p>Please define it in your <code>settings.local.php</code> file, located at <code>sites/default/settings.local.php</code>.</p>
         <p>Add the following line to your <code>settings.local.php</code> file:</p>
         <pre>$settings[\'vault_api_key\'] = \'your-secret-key-here\';</pre>
         <p>This approach ensures the API key is never exposed in exports or version control.</p>'
      ),
    ];

    $form['api_key_wrapper']['api_key'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Vault API Key'),
      '#default_value' => $this->vaultClient->getVaultApiKey() ?: '',
      '#attributes' => [
        'id' => 'edit-api-key',
        'type' => 'password',
        'autocomplete' => 'off',
        'readonly' => 'readonly',
      ],
    ];

    $form['api_key_wrapper']['show_api_key'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Show API Key'),
      '#default_value' => 0,
    ];

    $form['#attached']['library'][] = 'vault_migration/show_password';

    return $form;
  }

    /**
   * Adds the "Load databases" AJAX-enabled submit button.
   *
   * @param array $form
   *   The existing form array.
   *
   * @return array
   *   The updated form array with the load button.
   */
  private function buildLoadDataBasesButton(array $form): array {
    $form['load_button'] = [
      '#type' => 'submit',
      '#value' => $this->t('Load databases'),
      '#submit' => [[$this, 'loadDatabasesCallback']],
      '#limit_validation_errors' => [],
      '#ajax' => [
        'callback' => '::reloadForm',
        'wrapper' => 'vault-migration-wrapper',
      ],
    ];
    return $form;
  }

  /**
   * Adds the "Save configuration" primary submit button.
   *
   * @param array $form
   *   The existing form array.
   *
   * @return array
   *   The updated form array with the submit button.
   */
  private function addSubmitButton(array $form): array {
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Save configuration'),
      '#button_type' => 'primary',
      '#weight' => 10,
    ];
    return $form;
  }

  /**
   * Builds the form section for a specific Vault database.
   *
   * @param array $form
   *   The existing form array.
   * @param FormStateInterface $form_state
   *   The current form state.
   * @param array $db
   *   The Vault database information (id and name).
   * @param array $saved
   *   Previously saved configuration.
   *
   * @return array
   *   The updated form array with the database section.
   */
  private function buildDatabaseSection(array $form, FormStateInterface $form_state, array $db, array $saved): array {
    $dbId = $db['id'];
    $dbName = $db['name'];

    $existing = $this->findSavedEntry($dbId, $saved) ?? [];
    $input = $form_state->getUserInput();
    $selected_type = $input['db_' . $dbId]['drupal_type'] ?? ($existing['drupal_type'] ?? NULL);
    $saved_mapping = $existing['field_mapping'] ?? [];

    // Attach collapsible fieldset behavior
    $form['#attached']['library'][] = 'core/drupal.collapse';

    $form['db_' . $dbId] = [
      '#type' => 'details',
      '#title' => $this->t('Database: @name', ['@name' => $dbName]),
      '#tree' => TRUE,
      '#attributes' => ['class' => ['collapsible']],
      '#collapsible' => TRUE,
      '#open' => TRUE,
      '#prefix' => '<div id="db-wrapper-' . $dbId . '">',
      '#suffix' => '</div>',
    ];

    $form['db_' . $dbId]['enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable sync for this database'),
      '#default_value' => !empty($existing),
    ];

    $form['db_' . $dbId]['drupal_type'] = $this->buildDrupalTypeSelect($dbId, $selected_type);
    $form['db_' . $dbId]['publish_property'] = $this->buildPublishPropertySelect($dbId, $dbName, $existing);
    $form['db_' . $dbId]['translations'] = $this->buildTranslationSettingsSection($dbId, $dbName, $existing);

    $form['db_' . $dbId]['field_mapping'] = $this->buildFieldMappingSection($dbId, $selected_type, $saved_mapping);

    return $form;
  }

  /**
   * Returns the matching saved entry for the given database ID.
   *
   * @param string $dbId
   *   The Vault database ID to search for.
   * @param array $saved
   *   The array of previously saved database mappings.
   *
   * @return array|null
   *   The matching saved entry array if found, or NULL otherwise.
   */
  private function findSavedEntry(string $dbId, array $saved): ?array {
    foreach ($saved as $entry) {
      if ($entry['id'] === $dbId) {
        return $entry;
      }
    }
    return NULL;
  }

  /**
   * Builds a select form element for choosing a Drupal content type.
   *
   * Populates the options with available node types and sets a default value.
   *
   * @param string $dbId
   *   The Vault database ID associated with this select.
   * @param string|null $default
   *   The default selected content type, if any.
   *
   * @return array
   *   A render array for the Drupal content type select element.
   */
  private function buildDrupalTypeSelect(string $dbId, ?string $default): array {
    $content_types = $this->entityTypeManager->getStorage('node_type')->loadMultiple();

    $pairs = [];
    foreach ($content_types as $type) {
      $pairs[] = [
        'id' => $type->id(),
        'label' => $type->label(),
      ];
    }

    usort($pairs, fn($a, $b) => strcasecmp($a['label'], $b['label']));

    $options = [];
    foreach ($pairs as $pair) {
      $options[$pair['id']] = $pair['label'];
    }

    // Sort by label (value), not by key
    asort($options, SORT_NATURAL | SORT_FLAG_CASE);

    return [
      '#type' => 'select',
      '#title' => $this->t('Drupal content type'),
      '#options' => $options,
      '#default_value' => $default,
      '#empty_option' => $this->t('- Select type -'),
      '#ajax' => [
        'callback' => '::refreshDbSectionCallback',
        'wrapper' => 'db-wrapper-' . $dbId,
      ],
      '#limit_validation_errors' => [],
    ];
  }

  /**
   * Builds a select form element for choosing the Vault publication field.
   *
   * This field is used to determine whether a Vault entry should be published.
   *
   * @param string $dbId
   *   The ID of the Vault database.
   * @param string $dbName
   *   The name of the Vault database (for user-facing messages).
   * @param array $existing
   *   The saved configuration for this database, if any.
   *
   * @return array
   *   A render array for the publication property select element.
   */
  private function buildPublishPropertySelect(string $dbId, string $dbName, array $existing): array {
    $options = [];
    try {
      $vault_fields = $this->loadVaultFields($dbId);
      foreach ($vault_fields as $field) {
        $label = $field['name'];
        $options[$label] = $label;
      }
    }
    catch (\Exception $e) {
      $this->messenger()->addWarning($this->t(
        'Failed to load fields from Vault database "@name": @msg',
        ['@name' => $dbName, '@msg' => $e->getMessage()]
      ));
    }

    asort($options, SORT_NATURAL | SORT_FLAG_CASE);

    return [
      '#type' => 'select',
      '#title' => $this->t('Vault field to indicate publication'),
      '#options' => $options,
      '#default_value' => $existing['publish_property'] ?? NULL,
      '#empty_option' => $this->t('- None -'),
      '#description' => $this->t('Select the Vault field that indicates whether the record should be published (e.g., a "Publish" checkbox).'),
    ];
  }

  /**
   * Builds the field mapping section between Vault and Drupal fields.
   *
   * @param string $dbId
   *   The ID of the Vault database.
   * @param string|null $selected_type
   *   The selected Drupal content type.
   * @param array $saved_mapping
   *   Previously saved field mappings for this database.
   *
   * @return array
   *   A render array for the collapsible mapping section.
   */
  private function buildFieldMappingSection(string $dbId, ?string $selected_type, array $saved_mapping): array {
    $section = [
      '#type' => 'details',
      '#title' => $this->t('Field mapping Vault → Drupal'),
      '#collapsible' => TRUE,
      '#open' => TRUE,
    ];

    $vault_fields = $this->loadVaultFields($dbId);
    $drupal_fields = $this->loadDrupalFieldOptions($selected_type);
    // Sort by label (value), not by key
    asort($drupal_fields, SORT_NATURAL | SORT_FLAG_CASE);

    foreach ($vault_fields as $field) {
      $prop = $field['name'];
      $default_map = $saved_mapping[$prop] ?? NULL;

      $section[$prop . '_map'] = [
        '#type' => 'select',
        '#title' => $this->t('Drupal field for “@field”', ['@field' => $prop]),
        '#options' => $drupal_fields,
        '#default_value' => $default_map,
        '#empty_option' => $this->t('- no mapping -'),
      ];
    }

    return $section;
  }

  /**
   * Adds global Vault API configuration settings to the form.
   *
   * Includes cache TTL, maximum retry attempts, and request timeout.
   *
   * @param array $form
   *   The existing form structure to which the settings will be added.
   *
   * @return array
   *   The updated form array with global configuration fields appended.
   */
  protected function buildGlobalSettings(array $form): array {
    $form['global_settings'] = [
      '#type' => 'details',
      '#title' => $this->t('Advanced global settings'),
      '#open' => FALSE,
    ];

    $form['global_settings']['cache_ttl'] = [
      '#type' => 'number',
      '#title' => $this->t('Cache TTL (seconds)'),
      '#default_value' => $this->configManager->getCacheTtl(),
      '#min' => 60,
      '#description' => $this->t('How long (in seconds) cached API responses should remain valid.'),
    ];

    $form['global_settings']['max_retries'] = [
      '#type' => 'number',
      '#title' => $this->t('Max API retries'),
      '#default_value' => $this->configManager->getMaxRetries(),
      '#min' => 0,
      '#description' => $this->t('Number of retry attempts when Vault API returns rate limits (HTTP 429). Default: 3.'),
    ];

    $form['global_settings']['timeout'] = [
      '#type' => 'number',
      '#title' => $this->t('Request timeout (seconds)'),
      '#default_value' => $this->configManager->getTimeout(),
      '#min' => 1,
      '#description' => $this->t('Maximum execution time for API requests. Default: 60 seconds.'),
    ];

    $hours = array_combine(range(1, 24), range(1, 24));
    $form['global_settings']['time_full_sync'] = [
      '#type' => 'select',
      '#title' => $this->t('Time (h) to full sync'),
      '#options' => $hours,
      '#default_value' => $this->configManager->getTimeFullSync(),
      '#description' => $this->t('Interval in hours to trigger a full synchronization pass.'),
    ];

      $current_batch = (int) (\Drupal::config('vault_migration.settings')->get('sync.batch_size') ?? 200);
      $form['global_settings']['sync_batch_size'] = [
          '#type' => 'number',
          '#title' => $this->t('Sync flush batch size'),
          '#default_value' => $current_batch > 0 ? $current_batch : 200,
          '#min' => 1,
          '#description' => $this->t('How many content-key groups to process before flushing pending writes to Vault. Default: 200.'),
      ];

    return $form;
  }

  /**
   * Loads and sorts Vault fields for the given database.
   *
   * @param string $dbId
   *   The Vault database ID.
   *
   * @return array
   *   A list of Vault field definitions.
   */
  private function loadVaultFields(string $dbId): array {
    try {
      $raw = $this->vaultClient->getDatabaseProperties($dbId);
      $fields = $raw['properties'] ?? [];

      $field_list = [];
      foreach ($fields as $name => $definition) {
        if (is_array($definition)) {
          $definition['name'] = $name;
          $field_list[] = $definition;
        }
      }

      usort($field_list, fn($a, $b) => strcasecmp($a['name'], $b['name']));
      return $field_list;
    } catch (\Exception $e) {
      $this->messenger()->addWarning($this->t('Could not load fields for DB "@id": @msg', [
        '@id' => $dbId,
        '@msg' => $e->getMessage(),
      ]));
      return [];
    }
  }

  /**
   * Loads and sorts available Drupal fields for the selected content type.
   *
   * @param string|null $selected_type
   *   The Drupal content type ID.
   *
   * @return array
   *   An associative array of field machine names => labels.
   */
  private function loadDrupalFieldOptions(?string $selected_type): array {
    $options = [];

    // Default base node fields
    $base_fields = [
      'title' => $this->t('Title'),
      'langcode' => $this->t('Language'),
      'created' => $this->t('Created date'),
      'changed' => $this->t('Last modified'),
      'uid' => $this->t('Author'),
    ];

    $options = $base_fields;

    if (!$selected_type) {
      return $options;
    }

    try {
      $field_definitions = $this->entityFieldManager->getFieldDefinitions('node', $selected_type);

      $field_label_pairs = [];
      foreach ($field_definitions as $field_name => $definition) {
        if (!isset($options[$field_name]) && $definition->isDisplayConfigurable('form')) {
          $field_label_pairs[] = [
            'name' => $field_name,
            'label' => $definition->getLabel(),
          ];
        }
      }

      usort($field_label_pairs, fn($a, $b) => strcasecmp($a['label'], $b['label']));

      foreach ($field_label_pairs as $pair) {
        $options[$pair['name']] = $pair['label'];
      }
    } catch (\Exception $e) {
      $this->messenger()->addError($this->t('Unable to load fields for content type "@type": @msg', [
        '@type' => $selected_type,
        '@msg' => $e->getMessage(),
      ]));
    }

    return $options;
  }

  /**
   * Handles the "Load databases" button submit.
   *
   * This method retrieves the API key (if needed) and marks the form
   * for rebuilding, which will re-trigger the loading of Vault databases.
   *
   * @param array $form
   *   The form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   */
  public function loadDatabasesCallback(array &$form, FormStateInterface $form_state): void {
    $api_key = $form_state->getValue('api_key');
    $form_state->setRebuild(TRUE);
  }

  /**
   * AJAX callback that reloads the entire form.
   *
   * This is invoked after the "Load databases" button is clicked.
   *
   * @param array $form
   *   The current form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current form state.
   *
   * @return array
   *   The full form render array.
   */
  public function reloadForm(array &$form, FormStateInterface $form_state): array {
    return $form;
  }

  /**
   * Form submission handler for the Vault Bridge configuration form.
   *
   * This processes the user input, collects the enabled databases,
   * maps Vault properties to Drupal fields, and saves the configuration.
   *
   * @param array $form
   *   The full form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current form state.
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    try {
      $databases = $this->vaultClient->searchDatabases();
    } catch (\Exception $e) {
      $this->messenger()->addError($this->t('Could not fetch database list after saving the key: @msg', [
        '@msg' => $e->getMessage(),
      ]));
      $form_state->setRebuild(TRUE);
      return;
    }

    $end = [];

    // Collect global columns (first non-empty wins) and per-bundle DB IDs / field maps.
    $columns = [
      'content_key_base' => NULL,
      'content_key_formula' => NULL,
      'original_content_key_rollup' => NULL,
      'original_rel' => NULL,
      'lang' => NULL,
      'status' => NULL,
      'title' => NULL,
      'status_published_value' => NULL,
    ];
    $dbMap = [];
    $fieldMapsByBundle = [];

    foreach ($databases as $db) {
      $dbId = $db['id'];
      $entry = $form_state->getValue('db_' . $dbId) ?: [];
      if (empty($entry['enabled'])) {
        continue;
      }

      $temp = [
        'name' => $db['name'],
        'id' => $dbId,
        'drupal_type' => $entry['drupal_type'],
        'field_mapping' => [],
        'publish_property' => $entry['publish_property'] ?? NULL,
      ];

      if (!empty($entry['field_mapping'])) {
        foreach ($entry['field_mapping'] as $vaultFieldMapKey => $drupalField) {
          $vaultFieldName = str_replace('_map', '', $vaultFieldMapKey);
          if (!empty($drupalField)) {
            $temp['field_mapping'][$vaultFieldName] = $drupalField;
          }
        }
      }

      // Persist bundle→database and per-bundle field map for the sync manager.
      if (!empty($temp['drupal_type'])) {
        $dbMap[$temp['drupal_type']] = $dbId;
      }

      // Capture per-bundle field map and invert to Drupal→Vault for columns.field_map.<bundle>.
      if (!empty($temp['drupal_type']) && !empty($temp['field_mapping'])) {
        $inverted = [];
        foreach ($temp['field_mapping'] as $vaultProp => $drupalField) {
          // Only keep valid, non-empty pairs.
          if (!empty($drupalField) && is_string($drupalField)) {
            $inverted[$drupalField] = $vaultProp;
          }
        }
        if (!empty($inverted)) {
          $fieldMapsByBundle[$temp['drupal_type']] = $inverted;
        }
      }

      // Extract Translation settings (columns.*) from the DB section; use first non-empty values.
      $tr = $entry['translations']['columns'] ?? [];
      foreach (['content_key_base','content_key_formula','original_content_key_rollup','original_rel','lang','status','title','status_published_value'] as $key) {
        if ($columns[$key] === NULL && !empty($tr[$key])) {
          $columns[$key] = (string) $tr[$key];
        }
      }

      $end[] = $temp;
    }

    // Write new configuration expected by the SyncManager.
    $editable = \Drupal::configFactory()->getEditable('vault_migration.settings');

    // databases.<bundle> → Vault DB ID
    if (!empty($dbMap)) {
      $editable->set('databases', $dbMap);
    }

    // columns.field_map.<bundle> → Drupal→Vault field maps (inverted)
    if (!empty($fieldMapsByBundle)) {
      $editable->set('columns.field_map', $fieldMapsByBundle);
    }

    // Global columns.* (first non-empty from any enabled DB), with sensible fallbacks.
    $defaults = [
      'content_key_base' => 'Content_key',
      'content_key_formula' => 'Formula Content_key',
      'original_content_key_rollup' => 'Original Content_key',
      'original_rel' => 'Original',
      'lang' => 'idioma',
      'status' => 'estat',
      'title' => 'titol',
      'status_published_value' => 'Published',
    ];
    foreach ($defaults as $k => $v) {
      $editable->set('columns.' . $k, $columns[$k] !== NULL ? $columns[$k] : $editable->get('columns.' . $k) ?? $v);
    }

    $editable->save();

    // Save sync settings.
    $batch = (int) $form_state->getValue('sync_batch_size');
    if ($batch < 1) {
        $batch = 200;
    }
    \Drupal::configFactory()->getEditable('vault_migration.settings')
        ->set('sync.batch_size', $batch)
        ->save();

    $this->configManager->save($end);
    $this->configManager->setCacheTtl((int) $form_state->getValue('cache_ttl'));
    $this->configManager->setMaxRetries((int) $form_state->getValue('max_retries'));
    $this->configManager->setTimeFullSync((int) $form_state->getValue('time_full_sync'));
    $this->configManager->setTimeout((int) $form_state->getValue('timeout'));

    $this->messenger()->addStatus($this->t('Configuration saved successfully.'));
    $form_state->setRebuild(TRUE);
    $form_state->setRedirect('<current>');
  }

  /**
   * AJAX callback to refresh a single database section when the Drupal content
   * type select element is changed.
   *
   * This allows dynamic update of the field mapping area based on the selected type.
   *
   * @param array $form
   *   The current form render array.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current form state.
   *
   * @return array
   *   The partial render array for the changed database section.
   */
  public function refreshDbSectionCallback(array &$form, FormStateInterface $form_state): array {
    $triggering_element = $form_state->getTriggeringElement();
    $parents = $triggering_element['#array_parents'];
    $db_key = $parents[0]; // Example: db_123456789

    return $form[$db_key] ?? [];
  }
  /**
   * Builds the Translation settings subsection for a Vault database.
   *
   * Provides configuration for column names used by the sync manager:
   *  - Content_key (base), Formula Content_key, Original Content_key (rollup)
   *  - Language, Status, Title
   *  - Published value (for the selected Status property)
   *
   * @param string $dbId
   *   Vault database ID.
   * @param string $dbName
   *   Vault database name (for messages).
   * @param array $existing
   *   Previously saved configuration for this database (if any).
   *
   * @return array
   *   Render array for the translations settings section.
   */
  private function buildTranslationSettingsSection(string $dbId, string $dbName, array $existing): array {
    // Load Vault fields to populate selects.
    $options = [];
    try {
      $vault_fields = $this->loadVaultFields($dbId);
      foreach ($vault_fields as $field) {
        $label = $field['name'];
        $options[$label] = $label;
      }
    }
    catch (\Exception $e) {
      $this->messenger()->addWarning($this->t(
        'Failed to load fields from Vault database "@name": @msg',
        ['@name' => $dbName, '@msg' => $e->getMessage()]
      ));
    }
    asort($options, SORT_NATURAL | SORT_FLAG_CASE);

    // Read existing values (if any).
    $cols = $existing['columns'] ?? [];

    $section = [
      '#type' => 'details',
      '#title' => $this->t('Translation settings'),
      '#open' => TRUE,
    ];

    $section['columns'] = [
      '#type' => 'container',
      '#tree' => TRUE,
    ];

    // Content key (base): where Drupal writes a generated UUID when needed.
    $section['columns']['content_key_base'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Content_key (base) property'),
      '#default_value' => $cols['content_key_base'] ?? 'Content_key',
      '#description' => $this->t('Base Vault property where Drupal writes the generated content key. Do not edit this manually in Vault.'),
    ];

    // Formula Content_key: derived field in Vault that resolves original vs translation.
    $section['columns']['content_key_formula'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Formula Content_key property'),
      '#default_value' => $cols['content_key_formula'] ?? 'Formula Content_key',
      '#description' => $this->t('Formula property that yields the effective Content_key. Drupal only reads this value.'),
    ];

    // Rollup from Original -> Content_key.
    $section['columns']['original_content_key_rollup'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Original Content_key (rollup) property'),
      '#default_value' => $cols['original_content_key_rollup'] ?? 'Original Content_key',
      '#description' => $this->t('Rollup property that pulls the Content_key from the related "Original" entry.'),
    ];

    // Relation to the original entry (Vault relation property).
    $section['columns']['original_rel'] = [
      '#type' => 'select',
      '#title' => $this->t('Original relation property'),
      '#options' => $options,
      '#default_value' => $cols['original_rel'] ?? 'Original',
      '#empty_option' => $this->t('- Select -'),
      '#description' => $this->t('Select the Vault relation property that links a translation to its original entry.'),
    ];

    // Language select.
    $section['columns']['lang'] = [
      '#type' => 'select',
      '#title' => $this->t('Language property'),
      '#options' => $options,
      '#default_value' => $cols['lang'] ?? 'idioma',
      '#empty_option' => $this->t('- Select -'),
      '#description' => $this->t('Select the Vault property that stores the language code (e.g., ca, en, es).'),
    ];

    // Status select.
    $section['columns']['status'] = [
      '#type' => 'select',
      '#title' => $this->t('Status property'),
      '#options' => $options,
      '#default_value' => $cols['status'] ?? ($existing['publish_property'] ?? NULL),
      '#empty_option' => $this->t('- Select -'),
      '#description' => $this->t('Select the Vault property used to indicate publication status.'),
    ];

    // Title select.
    $section['columns']['title'] = [
      '#type' => 'select',
      '#title' => $this->t('Title property'),
      '#options' => $options,
      '#default_value' => $cols['title'] ?? 'titol',
      '#empty_option' => $this->t('- Select -'),
      '#description' => $this->t('Select the Vault property that holds the record title.'),
    ];

    // Published value (string), compared case-insensitively.
    $section['columns']['status_published_value'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Published value'),
      '#default_value' => $cols['status_published_value'] ?? 'Published',
      '#description' => $this->t('Exact value of the Status property that means "published" (comparison is case-insensitive).'),
    ];

    return $section;
  }
}
