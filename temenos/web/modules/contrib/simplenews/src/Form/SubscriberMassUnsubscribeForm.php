<?php

namespace Drupal\simplenews\Form;

use Drupal\Component\Utility\EmailValidatorInterface;
use Drupal\Component\Utility\Html;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\simplenews\Subscription\SubscriptionManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Do a mass subscription for a list of email addresses.
 */
class SubscriberMassUnsubscribeForm extends FormBase {

  /**
   * The subscription manager.
   *
   * @var \Drupal\simplenews\Subscription\SubscriptionManagerInterface
   */
  protected $subscriptionManager;

  /**
   * The email validator.
   *
   * @var \Drupal\Component\Utility\EmailValidatorInterface
   */
  protected $emailValidator;

  /**
   * Constructs a new SubscriberMassUnsubscribeForm.
   *
   * @param \Drupal\simplenews\Subscription\SubscriptionManagerInterface $subscription_manager
   *   The subscription manager.
   * @param \Drupal\Component\Utility\EmailValidatorInterface $email_validator
   *   The email validator.
   */
  public function __construct(SubscriptionManagerInterface $subscription_manager, EmailValidatorInterface $email_validator) {
    $this->subscriptionManager = $subscription_manager;
    $this->emailValidator = $email_validator;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('simplenews.subscription_manager'),
      $container->get('email.validator')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_subscriber_mass_unsubscribe';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form['emails'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Email addresses'),
      '#cols' => 60,
      '#rows' => 5,
      '#description' => $this->t('Email addresses must be separated by comma, space or newline.'),
    ];

    $form['newsletters'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Unsubscribe from'),
      '#options' => simplenews_newsletter_list(),
      '#required' => TRUE,
    ];

    foreach (simplenews_newsletter_get_all() as $id => $newsletter) {
      $form['newsletters'][$id]['#description'] = Html::escape($newsletter->description);
    }

    $form['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Unsubscribe'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $removed = [];
    $invalid = [];
    $checked_lists = array_keys(array_filter($form_state->getValue('newsletters')));

    $emails = preg_split("/[\s,]+/", $form_state->getValue('emails'));
    foreach ($emails as $email) {
      $email = trim($email);
      if ($this->emailValidator->isValid($email)) {
        foreach ($checked_lists as $newsletter_id) {
          $this->subscriptionManager->unsubscribe($email, $newsletter_id);
          $removed[] = $email;
        }
      }
      else {
        $invalid[] = $email;
      }
    }
    if ($removed) {
      $removed = implode(", ", $removed);
      $this->messenger()->addMessage($this->t('The following addresses were unsubscribed: %removed.', ['%removed' => $removed]));

      $newsletters = simplenews_newsletter_get_all();
      $list_names = [];
      foreach ($checked_lists as $newsletter_id) {
        $list_names[] = $newsletters[$newsletter_id]->label();
      }
      $this->messenger()->addMessage($this->t('The addresses were unsubscribed from the following newsletters: %newsletters.', ['%newsletters' => implode(', ', $list_names)]));
    }
    else {
      $this->messenger()->addMessage($this->t('No addresses were removed.'));
    }
    if ($invalid) {
      $invalid = implode(", ", $invalid);
      $this->messenger()->addError($this->t('The following addresses were invalid: %invalid.', ['%invalid' => $invalid]));
    }

    // Return to the parent page.
    $form_state->setRedirect('entity.simplenews_subscriber.collection');
  }

}
