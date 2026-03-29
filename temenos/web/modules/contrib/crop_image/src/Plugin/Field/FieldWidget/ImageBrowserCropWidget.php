<?php

namespace Drupal\crop_image\Plugin\Field\FieldWidget;

use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Render\Element\Select;
use Drupal\Core\Ajax\AjaxResponse;
use Drupal\Core\Ajax\ReplaceCommand;
use Drupal\crop\Entity\CropType;
use Drupal\entity_browser\Plugin\Field\FieldWidget\FileBrowserWidget;
use Drupal\Core\Render\Element;
use Drupal\Core\Link;

/**
 * Entity browser file widget.
 *
 * @FieldWidget(
 *   id = "entity_browser_image_crop",
 *   label = @Translation("ImageWidget crop (with browser)"),
 *   provider = "entity_browser",
 *   multiple_values = TRUE,
 *   field_types = {
 *     "image"
 *   }
 * )
 */
class ImageBrowserCropWidget extends FileBrowserWidget {

  /**
   * Instance of ImageWidgetCropManager object.
   *
   * @var \Drupal\image_widget_crop\ImageWidgetCropInterface
   */
  protected $imageWidgetCropManager;

  /**
   * The depth of the delete button.
   *
   * This property exists so it can be changed if subclasses.
   *
   * @var int
   */
  protected static $deleteDepth = 5;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->imageWidgetCropManager = $container->get('image_widget_crop.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public static function defaultSettings() {
    $widget_default_settings = \Drupal::config('crop_image.settings')->get('entity_browser_image_crop');
    return [
      'entity_browser' => 'image_browser',
      'regular_preview_image_style' => $widget_default_settings['preview_image_style'],
      'crop_preview_image_style' => $widget_default_settings['crop_preview_image_style'],
      'crop_list' => [],
      'crop_types_required' => [],
      'show_crop_area' => $widget_default_settings['show_crop_area'],
      'show_default_crop' => $widget_default_settings['show_default_crop'],
      'field_widget_remove' => $widget_default_settings['field_widget_remove'],
      'field_widget_replace' => $widget_default_settings['field_widget_replace'],
    ] + parent::defaultSettings();
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state) {
    $element = parent::settingsForm($form, $form_state);

    if (!$crop_types_options = $this->imageWidgetCropManager->getAvailableCropType(CropType::getCropTypeNames())) {
      $element['message'] = [
        '#type' => 'container',
        '#markup' => $this->t('No image style using the "manual crop" effect found. Please first go @link and attach the "manual crop" effect and then return to configure the field widget settings.', ['@link' => Link::createFromRoute('configure one here', 'entity.image_style.collection')->toString()]),
        '#attributes' => [
          'class' => ['messages messages--error'],
        ],
      ];

      // Stop process and display error message,
      // if any available Image Style is set.
      return $element;
    }

    // Unset the inherited setting, we use different settng name to take default settings configured.
    // Without conflicting with the image widget.
    unset($element['preview_image_style']);

    $has_file_entity = $this->moduleHandler->moduleExists('file_entity');

    $element['regular_preview_image_style'] = [
      '#title' => $this->t('Preview image style'),
      '#type' => 'select',
      '#options' => image_style_options(FALSE),
      '#default_value' => $this->getSetting('regular_preview_image_style'),
      '#description' => $this->t('The preview image will be shown while editing the content. Only relevant if using the default file view mode.'),
      '#weight' => 15,
      '#access' => !$has_file_entity && $this->fieldDefinition->getType() == 'image',
    ];

    $element['crop_preview_image_style'] = [
      '#title' => $this->t('Crop preview image style'),
      '#type' => 'select',
      '#options' => image_style_options(FALSE),
      '#default_value' => $this->getSetting('crop_preview_image_style'),
      '#description' => $this->t('The preview image will be shown while editing the content.'),
      '#weight' => 15,
    ];

    $element['crop_list'] = [
      '#title' => $this->t('Crop Type'),
      '#type' => 'select',
      '#options' => $crop_types_options,
      '#default_value' => $this->getSetting('crop_list'),
      '#multiple' => TRUE,
      '#required' => TRUE,
      '#description' => $this->t('The type of crop to apply to your image. If your Crop Type not appear here, set an image style use your Crop Type'),
      '#weight' => 16,
      '#ajax' => [
        'callback' => [static::class, 'updateCropTypeRequiredOptions'],
        'event' => 'change',
      ],
    ];

    $element['crop_types_required'] = [
      '#title' => $this->t('Required crop types'),
      '#type' => 'select',
      '#options' => $crop_types_options,
      '#default_value' => $this->getSetting('crop_types_required'),
      '#multiple' => TRUE,
      '#description' => $this->t('Crop types that should be required.'),
      '#weight' => 17,
    ];

    $element['show_crop_area'] = [
      '#title' => $this->t('Always expand crop area'),
      '#type' => 'checkbox',
      '#default_value' => $this->getSetting('show_crop_area'),
    ];

    $element['show_default_crop'] = [
      '#title' => $this->t('Show default crop area'),
      '#type' => 'checkbox',
      '#default_value' => $this->getSetting('show_default_crop'),
    ];

    $element['crop_types_required']['#process'] = [
      // We mandatory to re-attach 'processSelect'.
      [Select::class, 'processSelect'],
      [static::class, 'processCropTypesRequired'],
    ];

    return $element;
  }

  /**
   * Ajax callback for 'crop_list' select element.
   *
   * This ajax callback takes care of the following things:
   *  - Fetching selected options on the 'crop_list' element.
   *
   * @param array $form
   *   An associative array containing the structure of the form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   *
   * @return \Drupal\Core\Ajax\AjaxResponse
   *   The Ajax response.
   */
  public static function updateCropTypeRequiredOptions(array $form, FormStateInterface $form_state) {
    $response = new AjaxResponse();
    $triggering_element = $form_state->getTriggeringElement();
    if (isset($triggering_element['#value'])) {
      $crop_type_required_form = self::getImageCropWidgetElement($form_state, 'crop_types_required');
      $crop_type_required_form['#options'] = array_intersect_key($triggering_element['#options'], $triggering_element['#value']);

      /** @var \Drupal\Core\Render\RendererInterface $renderer */
      $renderer = \Drupal::service('renderer');
      $output = $renderer->renderRoot($crop_type_required_form);

      // Transform field name onto field name class.
      $field_name_class = str_replace('_', '-', $triggering_element['#parents'][1]);

      // Re-construct triggered crop required form element class.
      $element_fragments = [
        'form-item-',
        'fields-',
        $field_name_class,
        '-settings-edit-form-settings-',
        'crop-types-required',
      ];

      // Replace existing element with selected `crop_list` options.
      $response->addCommand(new ReplaceCommand('.' . implode($element_fragments), $output));
    }

    return $response;
  }

  /**
   * Return a specific of ImageCropWidget form element.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   * @param string $key
   *   Name of element needed.
   *
   * @return array
   *   The form element needed by $key parameter.
   */
  public static function getImageCropWidgetElement(FormStateInterface $form_state, $key) {
    $triggering_element = $form_state->getTriggeringElement();
    $children = $triggering_element['#parents'][0];
    $field_name = $triggering_element['#parents'][1];
    $field_element_form = $form_state->getCompleteForm()[$children][$field_name];

    return $field_element_form['plugin']['settings_edit_form']['settings'][$key] ?: [];
  }

  /**
   * Render API callback: retrieve options for current form element.
   *
   * @param array $element
   *   An associative array containing the properties and children of the
   *   form actions container.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   * @param array $complete_form
   *   The complete form structure.
   *
   * @return array
   *   The processed element.
   */
  public static function processCropTypesRequired(array &$element, FormStateInterface $form_state, array &$complete_form) {
    if (!$form_state->getTriggeringElement()) {
      return $element;
    }

    // Only display options chosen on 'crop_list',
    // element in current form element.
    $crop_list_form_element = self::getImageCropWidgetElement($form_state, 'crop_list');
    if (empty($crop_list_form_element)) {
      return $element;
    }

    $crop_list_options = $crop_list_form_element['#options'];
    $crop_list_default_value = array_flip($crop_list_form_element['#default_value']);

    // Populate element options with crop_list selected options.
    $element['#options'] = array_intersect_key($crop_list_options, $crop_list_default_value);

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSummary() {
    $preview = parent::settingsSummary();

    $image_styles = image_style_options(FALSE);
    // Unset possible 'No defined styles' option.
    unset($image_styles['']);

    $crop_list = $this->getSetting('crop_list');
    if (empty($crop_list)) {
      return [$this->t('No crop types selected.')];
    }

    $image_style_setting = $this->getSetting('regular_preview_image_style');
    $crop_preview = $image_styles[$this->getSetting('crop_preview_image_style')];
    $crop_show_button = $this->getSetting('show_crop_area');
    $show_default_crop = $this->getSetting('show_default_crop');
    $crop_required = $this->getSetting('crop_types_required');

    $preview[] = $this->t('Always expand crop area: @bool', ['@bool' => ($crop_show_button) ? 'Yes' : 'No']);
    $preview[] = $this->t('Show default crop area: @bool', ['@bool' => ($show_default_crop) ? 'Yes' : 'No']);

    if (isset($image_styles[$image_style_setting])) {
      $preview[] = $this->t('Preview image style: @style', ['@style' => $image_style_setting]);
    }
    else {
      $preview[] = $this->t('No preview image style');
    }

    if (isset($crop_preview)) {
      $preview[] = $this->t('Preview crop zone image style: @style', ['@style' => $crop_preview]);
    }

    if (!empty($crop_list)) {
      $preview[] = $this->t('Crop Type used: @list', ['@list' => implode(", ", $crop_list)]);
    }

    if (!empty($crop_required)) {
      $preview[] = $this->t('Required crop types : @list', ['@list' => implode(", ", $crop_required)]);
    }

    return $preview;
  }

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state) {
    // Add properties needed by process() method.
    $element['#crop_list'] = $this->getSetting('crop_list');
    $element['#crop_preview_image_style'] = $this->getSetting('crop_preview_image_style');
    $element['#show_crop_area'] = $this->getSetting('show_crop_area');
    $element['#show_default_crop'] = $this->getSetting('show_default_crop');
    $element['#crop_types_required'] = $this->getSetting('crop_types_required');

    $element = parent::formElement($items, $delta, $element, $form, $form_state);

    $element['#process'] =  [[get_class($this), 'process']];

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  protected function displayCurrentSelection($details_id, array $field_parents, array $entities) {
    $field_type = $this->fieldDefinition->getType();
    $field_settings = $this->fieldDefinition->getSettings();
    $field_machine_name = $this->fieldDefinition->getName();
    $file_settings = $this->configFactory->get('file.settings');
    $widget_settings = $this->getSettings();
    $view_mode = $widget_settings['view_mode'];
    $can_edit = (bool) $widget_settings['field_widget_edit'];
    $has_file_entity = $this->moduleHandler->moduleExists('file_entity');

    $delta = 0;

    $order_class = $field_machine_name . '-delta-order';

    $current = [
      '#type' => 'table',
      '#empty' => $this->t('No files yet'),
      '#attributes' => ['class' => ['entities-list']],
      '#tabledrag' => [
        [
          'action' => 'order',
          'relationship' => 'sibling',
          'group' => $order_class,
        ],
      ],
    ];

    if ($has_file_entity || $field_type == 'image' && !empty($widget_settings['regular_preview_image_style'])) {
      // Had the preview column if we have one.
      $current['#header'][] = $this->t('Preview');
    }

    $current['#header'][] = $this->t('Order', [], ['context' => 'Sort order']);

    /** @var \Drupal\file\FileInterface[] $entities */
    foreach ($entities as $entity) {
      // Check to see if this entity has an edit form. If not, the edit button
      // will only throw an exception.
      if (!$entity->getEntityType()->getFormClass('edit')) {
        $edit_button_access = FALSE;
      }
      elseif ($has_file_entity) {
        $edit_button_access = $can_edit && $entity->access('update', $this->currentUser);
      }

      // The "Replace" button will only be shown if this setting is enabled in
      // the widget, and there is only one entity in the current selection.
      $replace_button_access = $this->getSetting('field_widget_replace') && (count($entities) === 1);

      $entity_id = $entity->id();

      // Find the default description.
      $description = '';
      $display_field = $field_settings['display_default'];
      $alt = '';
      $title = '';
      $weight = $delta;
      $width = NULL;
      $height = NULL;
      foreach ($this->items as $item) {
        if ($item->target_id == $entity_id) {
          if ($field_type == 'file') {
            $description = $item->description;
            $display_field = $item->display;
          }
          elseif ($field_type == 'image') {
            $alt = $item->alt;
            $title = $item->title;
            $width = $item->width;
            $height = $item->height;
          }
          $weight = $item->_weight ?: $delta;
        }
      }

      $current[$entity_id] = [
        '#attributes' => [
          'class' => ['draggable'],
          'data-entity-id' => $entity->getEntityTypeId() . ':' . $entity_id,
          'data-row-id' => $delta,
        ],
        '#entity' => $entity,
      ];

      // Provide a rendered entity if a view builder is available.
      if ($has_file_entity) {
        $current[$entity_id]['display'] = $this->entityTypeManager->getViewBuilder('file')->view($entity, $view_mode);
      }
      // For images, support a preview image style as an alternative.
      elseif ($field_type == 'image' && !empty($widget_settings['regular_preview_image_style'])) {
        $uri = $entity->getFileUri();

        $current[$entity_id]['display'] = [
          '#type' => 'container',
        ];

        $current[$entity_id]['display']['preview'] = [
          '#weight' => -10,
          '#theme' => 'image_style',
          '#width' => $width,
          '#height' => $height,
          '#style_name' => $widget_settings['regular_preview_image_style'],
          '#uri' => $uri,
          '#weight' => 1,
        ];

        $current[$entity_id]['display']['alt'] = [
          '#type' => 'textfield',
          '#title' => $this->t('Alternative text'),
          '#default_value' => $alt,
          '#size' => 45,
          '#maxlength' => 512,
          '#description' => $this->t('This text will be used by screen readers, search engines, or when the image cannot be loaded.'),
          '#required' => TRUE,
          '#weight' => 2,
        ];
        $current[$entity_id]['display']['title'] = [
          '#type' => 'textfield',
          '#title' => $this->t('Title'),
          '#default_value' => $title,
          '#size' => 45,
          '#maxlength' => 1024,
          '#description' => $this->t('The title is used as a tool tip when the user hovers the mouse over the image.'),
          '#weight' => 3,
        ];

        $current[$entity_id]['display']['op'] = [
          '#type' => 'container',
          '#weight' => 4,
          'edit_button' => [
            '#type' => 'submit',
            '#value' => $this->t('Edit'),
            '#ajax' => [
              'url' => Url::fromRoute('entity_browser.edit_form', ['entity_type' => $entity->getEntityTypeId(), 'entity' => $entity_id]),
              'options' => ['query' => ['details_id' => $details_id]],
            ],
            '#attributes' => [
              'data-entity-id' => $entity->getEntityTypeId() . ':' . $entity->id(),
              'data-row-id' => $delta,
              'class' => ['edit-button'],
            ],
            '#access' => $edit_button_access,
          ],
          'replace_button' => [
            '#type' => 'submit',
            '#value' => $this->t('Replace'),
            '#ajax' => [
              'callback' => [get_class($this), 'updateWidgetCallback'],
              'wrapper' => $details_id,
            ],
            '#submit' => [[get_class($this), 'removeItemSubmit']],
            '#name' => $field_machine_name . '_replace_' . $entity_id . '_' . md5(json_encode($field_parents)),
            '#limit_validation_errors' => [array_merge($field_parents, [$field_machine_name, 'target_id'])],
            '#attributes' => [
              'data-entity-id' => $entity->getEntityTypeId() . ':' . $entity->id(),
              'data-row-id' => $delta,
              'class' => ['replace-button'],
            ],
            '#access' => $replace_button_access,
          ],
          'remove_button' => [
            '#type' => 'submit',
            '#value' => $this->t('Remove'),
            '#ajax' => [
              'callback' => [get_class($this), 'updateWidgetCallback'],
              'wrapper' => $details_id,
            ],
            '#submit' => [[get_class($this), 'removeItemSubmit']],
            '#name' => $field_machine_name . '_remove_' . $entity_id . '_' . md5(json_encode($field_parents)),
            '#limit_validation_errors' => [array_merge($field_parents, [$field_machine_name, 'target_id'])],
            '#attributes' => [
              'data-entity-id' => $entity->getEntityTypeId() . ':' . $entity->id(),
              'data-row-id' => $delta,
              'class' => ['remove-button'],
            ],
            '#access' => (bool) $widget_settings['field_widget_remove'],
          ],
        ];
      }

      $current[$entity_id] += [
        '_weight' => [
          '#type' => 'weight',
          '#title' => $this->t('Weight for row @number', ['@number' => $delta + 1]),
          '#title_display' => 'invisible',
          // Note: this 'delta' is the FAPI #type 'weight' element's property.
          '#delta' => count($entities),
          '#default_value' => $weight,
          '#attributes' => ['class' => [$order_class]],
        ],
      ];

      $current['#attached']['library'][] = 'entity_browser/file_browser';

      $delta++;
    }

    return $current;
  }

  /**
   * {@inheritdoc}
   */
  protected function formMultipleElements(FieldItemListInterface $items, array &$form, FormStateInterface $form_state) {
    $elements = parent::formMultipleElements($items, $form, $form_state);
    return $elements;
  }

  /**
   * Render API callback: Processes the entity browser element.
   */
  public static function process(&$element, FormStateInterface $form_state, &$complete_form) {
    foreach (Element::children($element['current']) as $item) {
      $element['current'][$item]['display']['crop'] = [
        '#type' => 'image_crop',
        '#file' => $element['current'][$item]['#entity'],
        '#crop_type_list' => $element['#crop_list'],
        '#crop_preview_image_style' => $element['#crop_preview_image_style'],
        '#show_default_crop' => $element['#show_default_crop'],
        '#show_crop_area' => $element['#show_crop_area'],
        '#warn_multiple_usages' => FALSE,
        '#crop_types_required' => $element['#crop_types_required'],
        '#weight' => 5,
      ];
    }

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function massageFormValues(array $values, array $form, FormStateInterface $form_state) {
    $return = parent:: massageFormValues($values, $form, $form_state);
    $ids = empty($values['target_id']) ? [] : explode(' ', trim($values['target_id']));
    // Take image crop information as well, so it will be processed by ImageWidgetCropManager::buildCropToEntity().
    foreach ($ids as $id) {
      $id = explode(':', $id)[1];
      if (is_array($values['current']) && isset($values['current'][$id])) {
        foreach ($return as &$item) {
          // @see static::process()
          $item['image_crop'] = $values['current'][$id]['display']['crop'];
          $item['alt'] = $values['current'][$id]['display']['alt'];
          $item['title'] = $values['current'][$id]['display']['title'];
        }
      }
    }
    return $return;
  }

}
