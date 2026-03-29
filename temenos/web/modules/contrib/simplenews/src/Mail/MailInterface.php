<?php

namespace Drupal\simplenews\Mail;

/**
 * A newsletter mail.
 *
 * @ingroup mail
 */
interface MailInterface {

  /**
   * Returns the newsletter issue entity.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   Newsletter issue entity.
   */
  public function getIssue();

  /**
   * Returns the subscriber object.
   *
   * @return \Drupal\simplenews\SubscriberInterface
   *   Subscriber object.
   */
  public function getSubscriber();

  /**
   * Returns the mail headers.
   *
   * @param array $headers
   *   The default mail headers.
   *
   * @return array
   *   Mail headers as an array.
   */
  public function getHeaders(array $headers);

  /**
   * Returns the mail subject.
   *
   * @return string
   *   The mail subject.
   */
  public function getSubject();

  /**
   * Returns the mail body.
   *
   * @return string
   *   The body, as plaintext or html depending on the format.
   */
  public function getBody();

  /**
   * Returns the plaintext body.
   *
   * @return string
   *   The body as plain text.
   */
  public function getPlainBody();

  /**
   * Returns the mail format.
   *
   * @return string
   *   The mail format as string, either 'plain' or 'html'.
   */
  public function getFormat();

  /**
   * Returns the recipient of this newsletter mail.
   *
   * @return string
   *   The recipient mail address(es) of this newsletter as a string.
   */
  public function getRecipient();

  /**
   * The language that should be used for this newsletter mail.
   *
   * @return string
   *   The langcode.
   */
  public function getLanguage();

  /**
   * Returns an array of attachments for this newsletter mail.
   *
   * @return array
   *   An array of managed file objects with properties uri, filemime and so on.
   */
  public function getAttachments();

  /**
   * Returns the token context to be used with token replacements.
   *
   * @return array
   *   An array of objects as required by token_replace().
   */
  public function getTokenContext();

  /**
   * Returns the mail key to be used for mails.
   *
   * @return string
   *   The mail key, either test, extra or node.
   */
  public function getKey();

  /**
   * Set the mail key.
   *
   * @param string $key
   *   The mail key, either test, extra or node.
   */
  public function setKey($key);

  /**
   * Returns the formatted from mail address.
   *
   * @return string
   *   The mail address with a name.
   */
  public function getFromFormatted();

  /**
   * Returns the plain mail address.
   *
   * @return string
   *   The mail address.
   */
  public function getFromAddress();

}
