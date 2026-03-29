<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure simplenews subscription settings.
 */
class SubscriptionSettingsForm extends ConfigFormBase {

  /**
   * The module handler.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * Constructs a \Drupal\simplenews\Form\SubscriptionSettingsForm object.
   *
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler.
   */
  public function __construct(ModuleHandlerInterface $module_handler) {
    $this->moduleHandler = $module_handler;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static($container->get('module_handler'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_admin_settings_subscription';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['simplenews.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('simplenews.settings');

    $form['subscription_verification'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Verification of anonymous users'),
      '#collapsible' => FALSE,
    ];

    $form['subscription_verification']['simplenews_verification'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Skip email verification (discouraged)'),
      '#default_value' => $config->get('subscription.skip_verification'),
      '#description' => $this->t('Anonymous users are normally required to confirm their email address before their subscription becomes active, which gives proof of consent and ensures that mails don\'t bounce due to a typo. With this setting enabled, the confirmation is skipped which means that an anonymous user can subscribe any email address.'),
    ];

    $form['subscription_tidy'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Tidy unconfirmed subscriptions'),
      '#collapsible' => FALSE,
    ];

    $form['subscription_tidy']['simplenews_tidy_unconfirmed'] = [
      '#type' => 'number',
      '#title' => t('Days'),
      '#default_value' => empty($database['port']) ? '' : $database['port'],
      '#min' => 0,
      '#max' => 365,
      '#description' => $this->t('Tidy unconfirmed subscriptions after a number of days (recommended), or zero to skip.'),
      '#default_value' => $config->get('subscription.tidy_unconfirmed'),
    ];

    $form['subscription_mail'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Subscriber emails'),
      '#collapsible' => FALSE,
    ];

    if ($this->moduleHandler->moduleExists('token')) {
      $form['subscription_mail']['token_help'] = [
        '#title' => $this->t('Replacement patterns'),
        '#type' => 'fieldset',
        '#collapsible' => TRUE,
        '#collapsed' => TRUE,
      ];

      $form['subscription_mail']['token_help']['browser'] = [
        '#theme' => 'token_tree_link',
        '#token_types' => ['simplenews-newsletter', 'simplenews-subscriber'],
      ];
    }

    $form['subscription_mail']['simplenews_confirm_subject'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Subject text for subscribe confirmation mail'),
      '#default_value' => $config->get('subscription.confirm_subject'),
    ];

    $form['subscription_mail']['simplenews_confirm_body'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Body text for subscribe confirmation mail'),
      '#default_value' => $config->get('subscription.confirm_body'),
      '#rows' => 5,
    ];

    $form['subscription_mail']['simplenews_validate_subject'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Subject text for validation mail'),
      '#default_value' => $config->get('subscription.validate_subject'),
    ];

    $form['subscription_mail']['simplenews_validate_body'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Body text for validation mail'),
      '#default_value' => $config->get('subscription.validate_body'),
      '#rows' => 5,
    ];

    $form['confirm_pages'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Confirmation pages'),
      '#collapsible' => FALSE,
    ];
    $form['confirm_pages']['simplenews_confirm_subscribe_page'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Subscribe confirmation'),
      '#description' => $this->t('Drupal path or URL of the destination page where after the subscription is confirmed (e.g. /node/123). Leave empty to go to the front page.'),
      '#default_value' => $config->get('subscription.confirm_subscribe_page'),
    ];
    $form['confirm_pages']['simplenews_confirm_unsubscribe_page'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Unsubscribe confirmation'),
      '#description' => $this->t('Drupal path or URL of the destination page when the subscription removal is confirmed (e.g. /node/123). Leave empty to go to the front page.'),
      '#default_value' => $config->get('subscription.confirm_unsubscribe_page'),
    ];
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('simplenews.settings')
      ->set('subscription.skip_verification', $form_state->getValue('simplenews_verification'))
      ->set('subscription.tidy_unconfirmed', $form_state->getValue('simplenews_tidy_unconfirmed'))
      ->set('subscription.confirm_subject', $form_state->getValue('simplenews_confirm_subject'))
      ->set('subscription.confirm_body', $form_state->getValue('simplenews_confirm_body'))
      ->set('subscription.validate_subject', $form_state->getValue('simplenews_validate_subject'))
      ->set('subscription.validate_body', $form_state->getValue('simplenews_validate_body'))
      ->set('subscription.confirm_subscribe_page', $form_state->getValue('simplenews_confirm_subscribe_page'))
      ->set('subscription.confirm_unsubscribe_page', $form_state->getValue('simplenews_confirm_unsubscribe_page'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
