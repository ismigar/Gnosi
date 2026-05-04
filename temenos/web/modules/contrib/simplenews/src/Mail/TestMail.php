<?php

namespace Drupal\simplenews\Mail;

/**
 * Example mail implementation used for tests.
 *
 * @ingroup mail
 */
class TestMail implements MailInterface {

  /**
   * The mail format.
   *
   * @var string
   */
  protected $format;

  /**
   * TestMail constructor.
   *
   * @param string $format
   *   The mail format as string, either 'plain' or 'html'.
   */
  public function __construct($format) {
    $this->format = $format;
  }

  /**
   * {@inheritdoc}
   */
  public function getAttachments() {
    return [
      [
        'uri' => 'example://test.png',
        'filemime' => 'x-example',
        'filename' => 'test.png',
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getBody() {
    return $this->getFormat() == 'plain' ? $this->getPlainBody() : 'the body';
  }

  /**
   * {@inheritdoc}
   */
  public function getFormat() {
    return $this->format;
  }

  /**
   * {@inheritdoc}
   */
  public function getFromAddress() {
    return 'simpletest@example.com';
  }

  /**
   * {@inheritdoc}
   */
  public function getFromFormatted() {
    return 'Test <simpletest@example.com>';
  }

  /**
   * {@inheritdoc}
   */
  public function getHeaders(array $headers) {
    $headers['X-Simplenews-Test'] = 'OK';
    return $headers;
  }

  /**
   * {@inheritdoc}
   */
  public function getKey() {
    return 'node';
  }

  /**
   * {@inheritdoc}
   */
  public function setKey($key) {
  }

  /**
   * {@inheritdoc}
   */
  public function getLanguage() {
    return 'en';
  }

  /**
   * {@inheritdoc}
   */
  public function getPlainBody() {
    return 'the plain body';
  }

  /**
   * {@inheritdoc}
   */
  public function getRecipient() {
    return 'recipient@example.org';
  }

  /**
   * {@inheritdoc}
   */
  public function getSubject() {
    return 'the subject';
  }

  /**
   * {@inheritdoc}
   */
  public function getTokenContext() {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIssue() {
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscriber() {
    return NULL;
  }

}
