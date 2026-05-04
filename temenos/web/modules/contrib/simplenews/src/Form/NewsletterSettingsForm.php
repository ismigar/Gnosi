<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Configure simplenews newsletter settings.
 */
class NewsletterSettingsForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_admin_settings_newsletter';
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
    $form['simplenews_customization'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Customization'),
      '#collapsible' => FALSE,
    ];
    $form['simplenews_customization']['issue_tokens'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Newsletter tokens (caution)'),
      '#default_value' => $config->get('newsletter.issue_tokens'),
      '#description' => $this->t('Enable tokens in newsletter issue fields. Show a token browser on the node edit page and replace tokens when viewing a node (which may reduce performance). Note that visitors (not logged in) are likely to see raw token codes, so disable this for a blog where old newsletters are public. Some tokens (especially links) don\'t work inside formatted text fields.'),
    ];

    $form['simplenews_default_options'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Default newsletter options'),
      '#collapsible' => FALSE,
      '#description' => $this->t('These options will be the defaults for new newsletters, but can be overridden in the newsletter editing form.'),
    ];
    $links = [':dsm_url' => 'http://drupal.org/project/symfony_mailer'];
    $description = $this->t('Default newsletter format. Install <a href=":dsm_url">Drupal Symfony Mailer</a> module to send newsletters in HTML format.', $links);
    $form['simplenews_default_options']['simplenews_format'] = [
      '#type' => 'select',
      '#title' => $this->t('Format'),
      '#options' => simplenews_format_options(),
      '#description' => $description,
      '#default_value' => $config->get('newsletter.format'),
    ];
    // @todo Do we need these master defaults for 'priority' and 'receipt'?
    $form['simplenews_default_options']['simplenews_priority'] = [
      '#type' => 'select',
      '#title' => $this->t('Priority'),
      '#options' => simplenews_get_priority(),
      '#description' => $this->t('Note that email priority is ignored by a lot of email programs.'),
      '#default_value' => $config->get('newsletter.priority'),
    ];
    $form['simplenews_default_options']['simplenews_receipt'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Request receipt'),
      '#default_value' => $config->get('newsletter.receipt'),
      '#description' => $this->t('Request a Read Receipt from your newsletters. A lot of email programs ignore these so it is not a definitive indication of how many people have read your newsletter.'),
    ];

    $form['simplenews_sender_info'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Sender information'),
      '#collapsible' => FALSE,
      '#description' => $this->t("Default sender address that will only be used for confirmation emails. You can specify sender information for each newsletter separately on the newsletter's settings page."),
    ];
    $form['simplenews_sender_info']['simplenews_from_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('From name'),
      '#size' => 60,
      '#maxlength' => 128,
      '#default_value' => $config->get('newsletter.from_name'),
    ];
    $form['simplenews_sender_info']['simplenews_from_address'] = [
      '#type' => 'email',
      '#title' => $this->t('From email address'),
      '#size' => 60,
      '#maxlength' => 128,
      '#required' => TRUE,
      '#default_value' => $config->get('newsletter.from_address'),
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('simplenews.settings')
      ->set('newsletter.issue_tokens', $form_state->getValue('issue_tokens'))
      ->set('newsletter.format', $form_state->getValue('simplenews_format'))
      ->set('newsletter.priority', $form_state->getValue('simplenews_priority'))
      ->set('newsletter.receipt', $form_state->getValue('simplenews_receipt'))
      ->set('newsletter.from_name', $form_state->getValue('simplenews_from_name'))
      ->set('newsletter.from_address', $form_state->getValue('simplenews_from_address'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
