<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Mail\MailManagerInterface;
use Drupal\Core\Url;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\Mail\MailerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * Do a mass subscription for a list of email addresses.
 */
class SubscriberValidateForm extends FormBase {

  /**
   * The mail manager.
   *
   * @var \Drupal\Core\Mail\MailManagerInterface
   */
  protected $mailManager;

  /**
   * The mailer service.
   *
   * @var \Drupal\simplenews\Mail\MailerInterface
   */
  protected $mailer;

  /**
   * Constructs a new SubscriberMassSubscribeForm.
   *
   * @param \Drupal\Core\Mail\MailManagerInterface $mail_manager
   *   The mail manager.
   * @param \Drupal\simplenews\Mail\MailerInterface $mailer
   *   The mailer service.
   */
  public function __construct(MailManagerInterface $mail_manager, MailerInterface $mailer) {
    $this->mailManager = $mail_manager;
    $this->mailer = $mailer;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('plugin.manager.mail'),
      $container->get('simplenews.mailer')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_subscriber_validate';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $user = $this->currentUser();
    if ($user->isAuthenticated()) {
      return new RedirectResponse(Url::fromRoute('simplenews.newsletter_subscriptions_user', ['user' => $user->id()])->toString());
    }

    $form['explain'] = [
      '#prefix' => '<p>',
      '#markup' => $this->t('Request an email with a link to manage your subscriptions.'),
      '#suffix' => '</p>',
    ];

    $form['mail'] = [
      '#type' => 'email',
      '#title' => $this->t('Email'),
      '#description' => $this->t('Subscribed email address'),
      '#required' => TRUE,
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = ['#type' => 'submit', '#value' => $this->t('Submit')];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $mail = trim($form_state->getValue('mail'));

    if (($subscriber = Subscriber::loadByMail($mail)) && $subscriber->isActive()) {
      if ($userId = $subscriber->getUserId()) {
        $this->messenger()->addStatus($this->t('Please log in to manage your subscriptions.'));
        $form_state->setRedirect('simplenews.newsletter_subscriptions_user', ['user' => $userId]);
        return;
      }

      $params['from'] = $this->mailer->getFrom();
      $params['context']['simplenews_subscriber'] = $subscriber;
      $this->mailManager->mail('simplenews', 'validate', $subscriber->getMail(), $subscriber->getLangcode(), $params, $params['from']['address']);
    }

    $this->messenger()
      ->addStatus($this->t('If %mail is subscribed, an email will be sent with a link to manage your subscriptions.', [
        '%mail' => $mail,
      ]));

    $form_state->setRedirect('<front>');
  }

}
