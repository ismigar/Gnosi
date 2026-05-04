<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\simplenews\Spool\SpoolStorageInterface;

/**
 * Configure simplenews newsletter settings.
 */
class MailSettingsForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_admin_settings_mail';
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
    $form['simplenews_mail_backend']['simplenews_use_cron'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Use cron to send newsletters'),
      '#default_value' => $config->get('mail.use_cron'),
      '#description' => $this->t('When checked cron will be used to send newsletters (recommended). Test newsletters and confirmation emails will be sent immediately. Leave unchecked for testing purposes.'),
    ];

    $form['simplenews_mail_backend']['simplenews_textalt'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Generate plain-text alternative'),
      '#default_value' => $config->get('mail.textalt'),
      '#description' => $this->t('Generate plain-text alternative for HTML mails (less recommended). If you are using the recommended <a href=":recommended">Drupal Symfony Mailer</a> module then disable this option and allow that module to generate them. If you enable this option then you need to configure both "Email: HTML" and "Email: Plain" view modes.', [':recommended' => 'https://www.drupal.org/project/symfony_mailer']),
    ];

    $throttle_val = [
      1, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
    ];
    $throttle = array_combine($throttle_val, $throttle_val);
    $throttle[SpoolStorageInterface::UNLIMITED] = $this->t('Unlimited');
    if (function_exists('getrusage')) {
      $description_extra = '<br />' . $this->t('Cron execution must not exceed the PHP maximum execution time of %max seconds. You can find the time taken to send emails in the <a href="/admin/reports/dblog">Recent log entries</a>.', ['%max' => ini_get('max_execution_time')]);
    }
    else {
      $description_extra = '<br />' . $this->t('Cron execution must not exceed the PHP maximum execution time of %max seconds.', ['%max' => ini_get('max_execution_time')]);
    }
    $form['simplenews_mail_backend']['simplenews_throttle'] = [
      '#type' => 'select',
      '#title' => $this->t('Cron throttle'),
      '#options' => $throttle,
      '#default_value' => $config->get('mail.throttle'),
      '#description' => $this->t('Sets the number of newsletters processed per cron run. Failures and skipped entries count towards the total.') . $description_extra,
    ];
    $form['simplenews_mail_backend']['simplenews_spool_expire'] = [
      '#type' => 'select',
      '#title' => $this->t('Mail spool expiration'),
      '#options' => [
        0 => $this->t('Immediate'),
        1 => $this->formatPlural(1, '1 day', '@count days'),
        7 => $this->formatPlural(1, '1 week', '@count weeks'),
        14 => $this->formatPlural(2, '1 week', '@count weeks'),
      ],
      '#default_value' => $config->get('mail.spool_expire'),
      '#description' => $this->t('Controls the duration that messages are retained in the spool after processing. Keeping messages in the spool can be useful for statistics or analysing errors.'),
    ];
    $form['simplenews_mail_backend']['simplenews_debug'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Log emails'),
      '#default_value' => $config->get('mail.debug'),
      '#description' => $this->t('When checked all outgoing simplenews emails are logged in the system log. A logged success does not guarantee delivery. The default PHP mail() function returns success without waiting to check if the mail can be delivered.'),
    ];
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('simplenews.settings')
      ->set('mail.use_cron', $form_state->getValue('simplenews_use_cron'))
      ->set('mail.textalt', $form_state->getValue('simplenews_textalt'))
      ->set('mail.source_cache', $form_state->getValue('simplenews_source_cache'))
      ->set('mail.throttle', $form_state->getValue('simplenews_throttle'))
      ->set('mail.spool_expire', $form_state->getValue('simplenews_spool_expire'))
      ->set('mail.debug', $form_state->getValue('simplenews_debug'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
