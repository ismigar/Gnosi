<?php

namespace Drupal\simplenews\Form;

use Drupal\Component\Utility\EmailValidatorInterface;
use Drupal\Component\Utility\Html;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\Subscription\SubscriptionManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Do a mass subscription for a list of email addresses.
 */
class SubscriberMassSubscribeForm extends FormBase {

  /**
   * The language manager.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;

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
   * Constructs a new SubscriberMassSubscribeForm.
   *
   * @param \Drupal\Core\Language\LanguageManagerInterface $language_manager
   *   The language manager.
   * @param \Drupal\simplenews\Subscription\SubscriptionManagerInterface $subscription_manager
   *   The subscription manager.
   * @param \Drupal\Component\Utility\EmailValidatorInterface $email_validator
   *   The email validator.
   */
  public function __construct(LanguageManagerInterface $language_manager, SubscriptionManagerInterface $subscription_manager, EmailValidatorInterface $email_validator) {
    $this->languageManager = $language_manager;
    $this->subscriptionManager = $subscription_manager;
    $this->emailValidator = $email_validator;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('language_manager'),
      $container->get('simplenews.subscription_manager'),
      $container->get('email.validator')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_subscriber_mass_subscribe';
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
      '#title' => $this->t('Subscribe to'),
      '#options' => simplenews_newsletter_list(),
      '#required' => TRUE,
    ];

    foreach (simplenews_newsletter_get_all() as $id => $newsletter) {
      $form['newsletters'][$id]['#description'] = Html::escape($newsletter->description);
    }

    $form['resubscribe'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Force resubscription'),
      '#description' => $this->t('If checked, previously unsubscribed e-mail addresses will be resubscribed. Consider that this might be against the will of your users.'),
    ];

    $form['language'] = [
      '#type' => 'language_select',
      '#title' => $this->t('Preferred language'),
      '#description' => $this->t('New subscriptions will be subscribed with the selected preferred language. The language of existing subscribers is unchanged.'),
    ];

    $form['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Subscribe'),
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $added = [];
    $invalid = [];
    $unsubscribed = [];
    $checked_newsletters = array_keys(array_filter($form_state->getValue('newsletters')));
    $langcode = $form_state->getValue('language');

    $emails = preg_split("/[\s,]+/", $form_state->getValue('emails'));
    foreach ($emails as $email) {
      $email = trim($email);
      if ($email == '') {
        continue;
      }
      if ($this->emailValidator->isValid($email)) {
        $subscriber = Subscriber::loadByMail($email, 'create', $langcode);

        /** @var \Drupal\simplenews\Entity\Newsletter $newsletter */
        foreach (Newsletter::loadMultiple($checked_newsletters) as $newsletter) {
          // If there is a valid subscriber, check if there is a subscription
          // for the current newsletter and if this subscription has the status
          // unsubscribed.
          $is_unsubscribed = $subscriber->isUnsubscribed($newsletter->id());
          if (!$is_unsubscribed || $form_state->getValue('resubscribe') == TRUE) {
            $subscriber->subscribe($newsletter->id())->save();
            $added[] = $email;
          }
          else {
            $unsubscribed[$newsletter->label()][] = $email;
          }
        }
      }
      else {
        $invalid[] = $email;
      }
    }
    if ($added) {
      $added = implode(", ", $added);
      $this->messenger()->addMessage($this->t('The following addresses were added or updated: %added.', ['%added' => $added]));

      $list_names = [];
      foreach (Newsletter::loadMultiple($checked_newsletters) as $newsletter) {
        $list_names[] = $newsletter->label();
      }
      $this->messenger()->addMessage($this->t('The addresses were subscribed to the following newsletters: %newsletters.', ['%newsletters' => implode(', ', $list_names)]));
    }
    else {
      $this->messenger()->addMessage($this->t('No addresses were added.'));
    }
    if ($invalid) {
      $invalid = implode(", ", $invalid);
      $this->messenger()->addError($this->t('The following addresses were invalid: %invalid.', ['%invalid' => $invalid]));
    }

    foreach ($unsubscribed as $name => $subscribers) {
      $subscribers = implode(", ", $subscribers);
      $this->messenger()->addWarning($this->t('The following addresses were skipped because they have previously unsubscribed from %name: %unsubscribed.', ['%name' => $name, '%unsubscribed' => $subscribers]));
    }

    if (!empty($unsubscribed)) {
      $this->messenger()->addWarning($this->t("If you would like to resubscribe them, use the 'Force resubscription' option."));
    }

    // Return to the parent page.
    $form_state->setRedirect('entity.simplenews_subscriber.collection');
  }

}
