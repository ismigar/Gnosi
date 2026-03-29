<?php

namespace Drupal\addtoany\Form;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Config\TypedConfigManagerInterface;
use Drupal\Core\Entity\ContentEntityType;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Extension\ExtensionList;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Link;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure AddToAny settings for this site.
 */
class AddToAnySettingsForm extends ConfigFormBase {
  /**
   * Drupal\Core\Extension\ModuleHandler definition.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * The module extension list service.
   *
   * @var \Drupal\Core\Extension\ExtensionList
   */
  protected $moduleExtensionList;

  /**
   * The entity type bundle info service.
   *
   * @var \Drupal\Core\Entity\EntityTypeBundleInfoInterface
   */
  protected $entityTypeBundleInfo;

  /**
   * Constructs a AddToAnySettingsForm object.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The factory for configuration objects.
   * @param \Drupal\Core\Config\TypedConfigManagerInterface $typed_config_manager
   *  The typed config manager.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler to invoke the alter hook with.
   * @param \Drupal\Core\Extension\ExtensionList $module_extension_list
   *   The module extension list service.
   * @param \Drupal\Core\Entity\EntityTypeBundleInfoInterface $entity_type_bundle_info
   *   The entity type bundle info service.
   */
  public function __construct(ConfigFactoryInterface $config_factory, TypedConfigManagerInterface $typed_config_manager, ModuleHandlerInterface $module_handler, ExtensionList $module_extension_list, EntityTypeBundleInfoInterface $entity_type_bundle_info) {
    parent::__construct($config_factory, $typed_config_manager);
    $this->moduleHandler = $module_handler;
    $this->moduleExtensionList = $module_extension_list;
    $this->entityTypeBundleInfo = $entity_type_bundle_info;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('config.factory'),
      $container->get('config.typed'),
      $container->get('module_handler'),
      $container->get('extension.list.module'),
      $container->get('entity_type.bundle.info')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'addtoany_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return [
      'addtoany.settings',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {

    global $base_path;

    $addtoany_settings = $this->config('addtoany.settings');
    $html_value = $addtoany_settings->get('additional_html');
    $js_value = $addtoany_settings->get('additional_js');
    $css_value = $addtoany_settings->get('additional_css');

    $button_img = '<img src="' . $base_path . $this->moduleExtensionList->getPath('addtoany') . '/images/%s" width="%d" height="%d"%s />';

    $button_options = [
      'default' => sprintf($button_img, 'a2a_32_32.svg', 32, 32, ' class="addtoany-round-icon"'),
      'custom' => $this->t('Custom button'),
      'none' => $this->t('None'),
    ];

    $attributes_for_code = [
      'autocapitalize' => ['off'],
      'autocomplete' => ['off'],
      'autocorrect' => ['off'],
      'spellcheck' => ['false'],
    ];

    // Attach CSS and JS.
    $form['#attached']['library'][] = 'addtoany/addtoany.admin';

    $form['addtoany_button_settings'] = [
      '#type'         => 'details',
      '#title'        => $this->t('Buttons'),
      '#open'         => TRUE,
    ];
    $form['addtoany_button_settings']['addtoany_buttons_size'] = [
      '#type'          => 'number',
      '#title'         => $this->t('Icon size'),
      '#field_suffix'  => ' ' . $this->t('pixels'),
      '#default_value' => $addtoany_settings->get('buttons_size'),
      '#size'          => 10,
      '#maxlength'     => 3,
      '#min'           => 8,
      '#max'           => 999,
      '#required'      => TRUE,
    ];
    $form['addtoany_button_settings']['addtoany_service_button_settings'] = [
      '#type'  => 'details',
      '#title' => $this->t('Service Buttons'),
      '#open'  => ($html_value !== '') ? TRUE : FALSE,
    ];
    $form['addtoany_button_settings']['addtoany_service_button_settings']['addtoany_additional_html'] = [
      '#type'          => 'textarea',
      '#title'         => $this->t('Service Buttons HTML code'),
      '#default_value' => $html_value,
      '#description'   => $this->t('You can add HTML code to display customized <a href="https://www.addtoany.com/buttons/customize/drupal/standalone_services" target="_blank">standalone service buttons</a> next to each universal share button. For example: <br /> <code>&lt;a class=&quot;a2a_button_facebook&quot;&gt;&lt;/a&gt;<br />&lt;a class=&quot;a2a_button_mastodon&quot;&gt;&lt;/a&gt;<br />&lt;a class=&quot;a2a_button_pinterest&quot;&gt;&lt;/a&gt;</code>
      '),
      '#attributes' => $attributes_for_code,
    ];
    $form['addtoany_button_settings']['universal_button'] = [
      '#type'  => 'details',
      '#title' => $this->t('Universal Button'),
      '#open'  => FALSE,
      /* #states workaround in addtoany.admin.js */
    ];
    $form['addtoany_button_settings']['universal_button']['addtoany_universal_button'] = [
      '#type'          => 'radios',
      '#title'         => $this->t('Button'),
      '#default_value' => $addtoany_settings->get('universal_button'),
      '#attributes'    => ['class' => ['addtoany-universal-button-option']],
      '#options'       => $button_options,
    ];
    $form['addtoany_button_settings']['universal_button']['addtoany_custom_universal_button'] = [
      '#type'          => 'textfield',
      '#title'         => $this->t('Custom button URL'),
      '#default_value' => $addtoany_settings->get('custom_universal_button'),
      '#description'   => $this->t('URL of the button image. Example: http://example.com/share.png'),
      '#states'        => [
        // Show only if custom button is selected.
        'visible' => [
          ':input[name="addtoany_universal_button"]' => ['value' => 'custom'],
        ],
      ],
    ];
    $form['addtoany_button_settings']['universal_button']['addtoany_universal_button_placement'] = [
      '#type'          => 'radios',
      '#title'         => $this->t('Button placement'),
      '#default_value' => $addtoany_settings->get('universal_button_placement'),
      '#options'       => [
        'after' => $this->t('After the service buttons'),
        'before' => $this->t('Before the service buttons'),
      ],
      '#states'        => [
        // Hide when universal sharing is disabled.
        'invisible' => [
          ':input[name="addtoany_universal_button"]' => ['value' => 'none'],
        ],
      ],
    ];

    $form['addtoany_additional_settings'] = [
      '#type'  => 'details',
      '#title' => $this->t('Additional options'),
      '#open'  => ($js_value !== '' || $css_value !== '') ? TRUE : FALSE,
    ];
    $form['addtoany_additional_settings']['addtoany_additional_js'] = [
      '#type'          => 'textarea',
      '#title'         => $this->t('Additional JavaScript'),
      '#default_value' => $js_value,
      '#description'   => $this->t('You can add special JavaScript code for AddToAny. See <a href="https://www.addtoany.com/buttons/customize/drupal" target="_blank">AddToAny documentation</a>.'),
      '#attributes' => $attributes_for_code,
    ];
    $form['addtoany_additional_settings']['addtoany_additional_css'] = [
      '#type'          => 'textarea',
      '#title'         => $this->t('Additional CSS'),
      '#default_value' => $css_value,
      '#description'   => $this->t('You can add special CSS code for AddToAny. See <a href="https://www.addtoany.com/buttons/customize/drupal" target="_blank">AddToAny documentation</a>.'),
      '#attributes' => $attributes_for_code,
    ];

    if ($this->moduleHandler->moduleExists('token')) {
      $form['tokens'] = [
        '#theme' => 'token_tree_link',
        '#token_types' => ['node'],
        '#global_types' => TRUE,
        '#click_insert' => TRUE,
        '#show_restricted' => FALSE,
        '#recursion_limit' => 3,
        '#text' => $this->t('Browse available tokens'),
      ];
    }

    $form['addtoany_entity_settings'] = [
      '#type'         => 'details',
      '#title'        => $this->t('Entities'),
    ];

    $form['addtoany_entity_settings']['addtoany_entity_tip_1'] = [
      '#type' => 'html_tag',
      '#tag' => 'p',
      '#value' => $this
        ->t('AddToAny is available on the &quot;Manage display&quot; pages of enabled entities, e.g. Structure &gt; Content types &gt; Article &gt; Manage display.'),
    ];

    $entities = self::getContentEntities();

    // Allow modules to alter the entity types.
    $this->moduleHandler->alter('addtoany_entity_types', $entities);

    // Whitelist the entity IDs that let us link to each bundle's Manage Display page.
    $linkableEntities = [
      'block_content', 'comment', 'commerce_product', 'commerce_store',
      'contact_message', 'media', 'node', 'paragraph',
    ];

    foreach ($entities as $entity) {
      $entityId = $entity->id();
      $entityType = $entity->getBundleEntityType();
      // Get all available bundles for the current entity.
      $bundles = $this->entityTypeBundleInfo->getBundleInfo($entityId);
      $links = [];

      foreach ($bundles as $machine_name => $bundle) {
        $label = $bundle['label'];

        // Some labels are TranslatableMarkup objects (such as the File entity).
        if ($label instanceof TranslatableMarkup) {
          $label = $label->render();
        }

        // Check if Field UI module enabled.
        if ($this->moduleHandler->moduleExists('field_ui')) {
          // Link to the bundle's Manage Display page if the entity ID supports the route pattern.
          if (in_array($entityId, $linkableEntities) && $entityType) {
            $links[] = Link::createFromRoute(t($label), "entity.entity_view_display.{$entityId}.default", [
              $entityType => $machine_name,
            ])->toString();
          }
        }
      }

      $description = empty($links) ? '' : '( ' . implode(' | ', $links) . ' )';

      $form['addtoany_entity_settings'][$entityId] = [
        '#type' => 'checkbox',
        '#title' => $this->t('@entity', ['@entity' => $entity->getLabel()]),
        '#default_value' => $addtoany_settings->get("entities.{$entityId}"),
        '#description' => $description,
        '#attributes' => ['class' => ['addtoany-entity-checkbox']],
      ];
    }

    $form['addtoany_entity_settings']['addtoany_entity_tip_2'] = [
      '#type' => 'html_tag',
      '#tag' => 'p',
      '#value' => $this->t('A cache rebuild may be required before changes take effect.'),
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $values = $form_state->getValues();
    $this->config('addtoany.settings')
      ->set('additional_css', $values['addtoany_additional_css'])
      ->set('additional_html', $values['addtoany_additional_html'])
      ->set('additional_js', $values['addtoany_additional_js'])
      ->set('buttons_size', $values['addtoany_buttons_size'])
      ->set('custom_universal_button', $values['addtoany_custom_universal_button'])
      ->set('universal_button', $values['addtoany_universal_button'])
      ->set('universal_button_placement', $values['addtoany_universal_button_placement']);

    foreach (self::getContentEntities() as $entity) {
      $entityId = $entity->id();
      $this->config('addtoany.settings')
        ->set("entities.{$entityId}", $values[$entityId]);
    }

    $this->config('addtoany.settings')->save();

    parent::submitForm($form, $form_state);
  }

  /**
   * Get all available content entities in the environment.
   * @return array
   */
  public static function getContentEntities() {
    $content_entity_types = [];
    $entity_type_definitions = \Drupal::entityTypeManager()->getDefinitions();
    /** @var EntityTypeInterface $definition */
    foreach ($entity_type_definitions as $definition) {
      if ($definition instanceof ContentEntityType) {
        $content_entity_types[] = $definition;
      }
    }

    return $content_entity_types;
  }
}
