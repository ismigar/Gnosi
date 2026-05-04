<?php

namespace Drupal\simplenews\Spool;

/**
 * A list of spooled mails.
 */
interface SpoolListInterface extends \Countable {

  /**
   * Returns a Simplenews mail to be sent.
   *
   * @return \Drupal\simplenews\Mail\MailInterface
   *   Next mail to be sent.
   */
  public function nextMail();

  /**
   * Records the result of sending the last mail.
   *
   * @param int $result
   *   One of the SpoolStorageInterface::STATUS_* constants.
   */
  public function setLastMailResult($result);

  /**
   * Returns the results of all mails that have been processed by this list.
   *
   * This function cancels any remaining mails in the list.
   *
   * @return array
   *   An array of mail spool rows. Each array value is a simplenews_mail_spool
   *   database row plus the following additional properties.
   *     - langcode: language used to send this mail.
   *     - result: one of the SpoolStorageInterface::STATUS_* constants.
   */
  public function getResults();

}
