<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\simplenews\NewsletterInterface;
use Drupal\simplenews\SubscriberInterface;

/**
 * Implements a removal confirmation form for simplenews subscriptions.
 */
class ConfirmRemovalForm extends ConfirmFormBase {

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Confirm remove subscription');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText() {
    return $this->t('Unsubscribe');
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription() {
    return $this->t('This action will unsubscribe you from the newsletter mailing list.');
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_confirm_removal';
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    return \Drupal::service('simplenews.subscription_manager')->getsubscriptionsUrl();
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?SubscriberInterface $subscriber = NULL, ?NewsletterInterface $newsletter = NULL) {
    $form = parent::buildForm($form, $form_state);

    $form['question'] = [
      '#markup' => '<p>' . $this->t('Are you sure you want to remove %user from the %newsletter mailing list?', ['%user' => simplenews_mask_mail($subscriber->getMail()), '%newsletter' => $newsletter->name]) . "<p>\n",
    ];
    $form['subscriber'] = [
      '#type' => 'value',
      '#value' => $subscriber,
    ];
    $form['newsletter'] = [
      '#type' => 'value',
      '#value' => $newsletter,
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $subscriber = $form_state->getValue('subscriber');
    $newsletter = $form_state->getValue('newsletter');
    $subscriber->unsubscribe($newsletter->id())->save();

    $config = \Drupal::config('simplenews.settings');
    if ($path = $config->get('subscription.confirm_unsubscribe_page')) {
      $form_state->setRedirectUrl(Url::fromUri("internal:$path"));
    }
    else {
      $this->messenger()->addMessage($this->t('%user was unsubscribed from the %newsletter mailing list.', ['%user' => $subscriber->getMail(), '%newsletter' => $newsletter->name]));
      $form_state->setRedirect('<front>');
    }
  }

}
