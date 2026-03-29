<?php

namespace Drupal\simplenews\Mail;

/**
 * Builds newsletter and confirmation mails.
 */
interface MailBuilderInterface {

  /**
   * Build subject and body of the test and normal newsletter email.
   *
   * @param array $message
   *   Message array as used by hook_mail().
   * @param \Drupal\simplenews\Mail\MailInterface $mail
   *   The mail object.
   */
  public function buildNewsletterMail(array &$message, MailInterface $mail);

  /**
   * Build subject and body of the subscribe confirmation email.
   *
   * @param array $message
   *   Message array as used by hook_mail().
   * @param array $params
   *   Parameter array as used by hook_mail().
   */
  public function buildSubscribeMail(array &$message, array $params);

  /**
   * Build subject and body of the validate email.
   *
   * @param array $message
   *   Message array as used by hook_mail().
   * @param array $params
   *   Parameter array as used by hook_mail().
   */
  public function buildValidateMail(array &$message, array $params);

}
