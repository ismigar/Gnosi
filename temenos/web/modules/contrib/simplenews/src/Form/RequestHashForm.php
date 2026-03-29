<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Requests a new confirmation if the link has expired.
 */
class RequestHashForm extends ConfirmFormBase {

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('This link has expired.');
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription() {
    return '';
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText() {
    return $this->t('Request new confirmation mail');
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_request_hash';
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    return \Drupal::service('simplenews.subscription_manager')->getsubscriptionsUrl();
  }

  /**
   * Request new hash form.
   *
   * @param array $form
   *   An associative array containing the structure of the form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   * @param string $key
   *   The mail key to be sent.
   * @param array $context
   *   Necessary context to send the mail. Must at least include the simplenews
   *   subscriber.
   *
   * @return array
   *   The form structure.
   */
  public function buildForm(array $form, FormStateInterface $form_state, $key = '', array $context = []) {
    $form = parent::buildForm($form, $form_state);
    $form_state->set('key', $key);
    $form_state->set('context', $context);

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $params['from'] = \Drupal::service('simplenews.mailer')->getFrom();
    $params['context'] = $form_state->get('context');
    $subscriber = $params['context']['simplenews_subscriber'];
    \Drupal::service('plugin.manager.mail')->mail('simplenews', $form_state->get('key'), $subscriber->getMail(), $subscriber->getLangcode(), $params, $params['from']['address']);
    $this->messenger()->addMessage($this->t('The confirmation mail has been sent.'));
    $form_state->setRedirect('<front>');
  }

}
