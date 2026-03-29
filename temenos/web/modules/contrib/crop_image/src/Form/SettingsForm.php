<?php

namespace Drupal\crop_image\Form;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\crop\Entity\CropType;
use Drupal\image_widget_crop\ImageWidgetCropInterface;
use GuzzleHttp\ClientInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure ImageWidgetCrop general settings for this site.
 */
class SettingsForm extends ConfigFormBase {

  /**
   * The settings of image_widget_crop configuration.
   *
   * @var array
   *
   * @see \Drupal\Core\Config\Config
   */
  protected $settings;

  /**
   * Instance of ImageWidgetCropManager object.
   *
   * @var \Drupal\image_widget_crop\ImageWidgetCropInterface
   */
  protected $imageWidgetCropManager;

  /**
   * The module handler to use to load modules.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * The HTTP client to fetch the feed data with.
   *
   * @var \GuzzleHttp\ClientInterface
   */
  protected $httpClient;

  /**
   * Constructs a CropWidgetForm object.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The factory for configuration objects.
   * @param \Drupal\image_widget_crop\ImageWidgetCropInterface $iwc_manager
   *   The ImageWidgetCrop manager service.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler to use to load modules.
   * @param \GuzzleHttp\ClientInterface $http_client
   *   The Guzzle HTTP client.
   */
  public function __construct(ConfigFactoryInterface $config_factory, ImageWidgetCropInterface $iwc_manager, ModuleHandlerInterface $module_handler, ClientInterface $http_client) {
    parent::__construct($config_factory);
    $this->settings = $this->config('crop_image.settings');
    $this->imageWidgetCropManager = $iwc_manager;
    $this->moduleHandler = $module_handler;
    $this->httpClient = $http_client;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static (
      $container->get('config.factory'),
      $container->get('image_widget_crop.manager'),
      $container->get('module_handler'),
      $container->get('http_client')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'crop_image_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['crop_image.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {

    $form['entity_browser_image_crop'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Default settings for the "ImageWidget crop (with browser)" widget')
    ];

    $form['entity_browser_image_crop']['help'] = [
      '#type' => 'markup',
      '#markup' => $this->t('These settings will be used as default settings on the "ImageWidget crop (with browser)" widget for image fields.')
    ];

    $form['entity_browser_image_crop']['preview_image_style'] = [
      '#title' => $this->t('Preview image style'),
      '#type' => 'select',
      '#options' => image_style_options(FALSE),
      '#default_value' => $this->settings->get('entity_browser_image_crop.preview_image_style'),
      '#description' => $this->t('The preview image will be shown while editing the content.'),
    ];

    $form['entity_browser_image_crop']['crop_preview_image_style'] = [
      '#title' => $this->t('Crop preview image style'),
      '#type' => 'select',
      '#options' => image_style_options(FALSE),
      '#default_value' => $this->settings->get('entity_browser_image_crop.crop_preview_image_style'),
      '#description' => $this->t('The preview image will be shown while editing the content.'),
    ];

    $form['entity_browser_image_crop']['show_crop_area'] = [
      '#title' => $this->t('Always expand crop area'),
      '#type' => 'checkbox',
      '#default_value' => $this->settings->get('entity_browser_image_crop.show_crop_area'),
      '#description' => $this->t('Whether to expand crop are by default.'),
    ];

    $form['entity_browser_image_crop']['show_default_crop'] = [
      '#title' => $this->t('Show default crop area'),
      '#type' => 'checkbox',
      '#default_value' => $this->settings->get('entity_browser_image_crop.show_default_crop'),
    ];

    $form['entity_browser_image_crop']['field_widget_remove'] = [
      '#title' => $this->t('Show remove button'),
      '#type' => 'checkbox',
      '#default_value' => $this->settings->get('entity_browser_image_crop.field_widget_remove'),
      '#description' => $this->t('Whether to show the remove button.'),
    ];

    $form['entity_browser_image_crop']['field_widget_replace'] = [
      '#title' => $this->t('Show replace button'),
      '#type' => 'checkbox',
      '#default_value' => $this->settings->get('entity_browser_image_crop.field_widget_replace'),
      '#description' => $this->t('Whether to show the replace button.'),
    ];

    $form['automatic_crop'] = [
      '#title' => $this->t('Automatic Crop'),
      '#type' => 'checkbox',
      '#default_value' => $this->settings->get('automatic_crop'),
      '#description' => $this->t('Automatically apply crop if user did not set.'),
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * Validation for cropper library.
   *
   * @param array $form
   *   An associative array containing the structure of the form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   *
   * @throws \GuzzleHttp\Exception\GuzzleException
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);

  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    parent::submitForm($form, $form_state);

    $this->settings
      ->set("entity_browser_image_crop.preview_image_style", $form_state->getValue('preview_image_style'))
      ->set("entity_browser_image_crop.crop_preview_image_style", $form_state->getValue('crop_preview_image_style'))
      ->set("entity_browser_image_crop.show_crop_area", $form_state->getValue('show_crop_area'))
      ->set("entity_browser_image_crop.show_default_crop", $form_state->getValue('show_default_crop'))
      ->set("entity_browser_image_crop.field_widget_remove", $form_state->getValue('field_widget_remove'))
      ->set("entity_browser_image_crop.field_widget_replace", $form_state->getValue('field_widget_replace'))
      ->set("automatic_crop", $form_state->getValue('automatic_crop'));
    $this->settings->save();
  }

}
