<?php

namespace Drupal\simplenews\Plugin\Field\FieldWidget;

use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\Plugin\Field\FieldWidget\OptionsSelectWidget;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\simplenews\recipientHandler\RecipientHandlerManager;
use Drupal\simplenews\Spool\SpoolStorageInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Plugin implementation of the 'simplenews_issue' widget.
 *
 * @FieldWidget(
 *   id = "simplenews_issue",
 *   label = @Translation("Issue"),
 *   field_types = {
 *     "simplenews_issue",
 *   },
 *   multiple_values = TRUE
 * )
 */
class IssueWidget extends OptionsSelectWidget implements ContainerFactoryPluginInterface {

  /**
   * The spool storage.
   *
   * @var \Drupal\simplenews\Spool\SpoolStorageInterface
   */
  protected $spoolStorage;

  /**
   * The recipient handler plugin manager.
   *
   * @var \Drupal\simplenews\RecipientHandler\RecipientHandlerManager
   */
  protected $recipientHandlerManager;

  /**
   * Constructs an IssueWidget.
   *
   * @param string $plugin_id
   *   The plugin_id for the widget.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The definition of the field to which the widget is associated.
   * @param array $settings
   *   The widget settings.
   * @param array $third_party_settings
   *   Any third party settings.
   * @param \Drupal\simplenews\Spool\SpoolStorageInterface $spool_storage
   *   The spool storage.
   * @param \Drupal\simplenews\recipientHandler\RecipientHandlerManager $recipient_handler_manager
   *   The recipient handler manager.
   */
  public function __construct($plugin_id, $plugin_definition, FieldDefinitionInterface $field_definition, array $settings, array $third_party_settings, SpoolStorageInterface $spool_storage, RecipientHandlerManager $recipient_handler_manager) {
    parent::__construct($plugin_id, $plugin_definition, $field_definition, $settings, $third_party_settings);
    $this->spoolStorage = $spool_storage;
    $this->recipientHandlerManager = $recipient_handler_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['third_party_settings'],
      $container->get('simplenews.spool_storage'),
      $container->get('plugin.manager.simplenews_recipient_handler')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state) {
    // Set a div to allow updating the entire widget when the newsletter is
    // changed.
    $element['#prefix'] = '<div id="simplenews-issue-widget">';
    $element['#suffix'] = '</div>';
    $element['target_id'] = parent::formElement($items, $delta, $element, $form, $form_state);
    $element['target_id']['#required'] = $this->required;
    $element['target_id']['#ajax'] = [
      'callback' => [$this, 'ajaxUpdateAll'],
      'wrapper' => 'simplenews-issue-widget',
      'method' => 'replaceWith',
      'effect' => 'fade',
    ];

    // This form is Ajax enabled, so fetch the existing values if present,
    // otherwise fall back to the defaults.
    $button = $form_state->getTriggeringElement();
    $values = $button ? $form_state->getValue($button['#array_parents'][0]) : NULL;
    [$handler, $options] = $this->spoolStorage->getRecipientHandler($items->getEntity(), $values, TRUE);
    $element['handler'] = [
      '#prefix' => '<div id="recipient-handler">',
      '#suffix' => '</div>',
    ];

    // Show the recipient handler field if there is more than one option and a
    // newsletter has been selected.
    if ((count($options) > 1) && !$items->isEmpty()) {
      $element['handler'] += [
        '#type' => 'select',
        '#title' => $this->t('Recipients'),
        '#description' => $this->t('How recipients should be selected.'),
        '#options' => $options,
        '#default_value' => $handler->getPluginId(),
        '#ajax' => [
          'callback' => [$this, 'ajaxUpdateRecipientHandlerSettings'],
          'wrapper' => 'recipient-handler-settings',
          'method' => 'replaceWith',
          'effect' => 'fade',
        ],
      ];
    }

    // Set a div to allow updating this field when the handler is changed.
    $element['handler_settings'] = $handler->settingsForm();
    $element['handler_settings']['#prefix'] = '<div id="recipient-handler-settings">';
    $element['handler_settings']['#suffix'] = '</div>';

    // Ensure that the extra properties are preserved.
    if (!$items->isEmpty()) {
      foreach ($items->first()->getValue() as $key => $value) {
        if (empty($element[$key])) {
          $element[$key] = [
            '#type' => 'value',
            '#value' => $value,
          ];
        }
      }
    }

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public static function validateElement(array $element, FormStateInterface $form_state) {
    // OptionsWidgetBase uses '_none' as a special value.
    if ($element['#value'] == '_none') {
      if ($element['#required']) {
        $form_state->setError($element, t('@name field is required.', ['@name' => $element['#title']]));
      }
      else {
        $form_state->setValueForElement($element, NULL);
      }
    }
  }

  /**
   * Return the entire widget updated.
   */
  public function ajaxUpdateAll($form, FormStateInterface $form_state) {
    // Determine the field name from the triggering element.
    $button = $form_state->getTriggeringElement();
    $element = NestedArray::getValue($form, array_slice($button['#array_parents'], 0, -1));
    return $element;
  }

  /**
   * Return the updated recipient handler settings field.
   */
  public function ajaxUpdateRecipientHandlerSettings($form, FormStateInterface $form_state) {
    // Determine the field name from the triggering element.
    $button = $form_state->getTriggeringElement();
    $element = NestedArray::getValue($form, array_slice($button['#array_parents'], 0, -1));
    return $element['handler_settings'];
  }

}
