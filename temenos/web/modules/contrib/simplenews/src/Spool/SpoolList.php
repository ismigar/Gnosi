<?php

namespace Drupal\simplenews\Spool;

use Drupal\simplenews\AbortSendingException;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\Mail\MailEntity;

/**
 * List of mail spool entries.
 */
class SpoolList implements SpoolListInterface {

  /**
   * Maximum number of consecutive errors to allow before aborting sending.
   */
  const MAX_ERRORS = 50;

  /**
   * The simplenews spool storage.
   *
   * @var \Drupal\simplenews\Spool\SpoolStorageInterface
   */
  protected $spoolStorage;

  /**
   * Array of mail spool rows being processed keyed by msid.
   *
   * @var array
   */
  protected $spoolRows;

  /**
   * Mail spool IDs with error SpoolStorageInterface::STATUS_PENDING.
   *
   * @var array
   */
  protected $pendingErrors = [];

  /**
   * Count of consecutive SpoolStorageInterface::STATUS_PENDING errors.
   *
   * These are 'unclassified': it's not known whether there is a global
   * transport failure or if it's a problem with a specific email address. If
   * there are too many in a row then assume it's a global error.
   *
   * @var int
   */
  protected $consecutivePendingErrors = 0;

  /**
   * Whether any mail has been sent successfully.
   *
   * @var bool
   */
  protected $success = FALSE;

  /**
   * Creates a spool list.
   *
   * @param array $spool_rows
   *   List of mail spool rows.
   * @param \Drupal\simplenews\Spool\SpoolStorageInterface $spool_storage
   *   The spool storage.
   */
  public function __construct(array $spool_rows, SpoolStorageInterface $spool_storage) {
    $this->spoolRows = $spool_rows;
    $this->spoolStorage = $spool_storage;
  }

  /**
   * {@inheritdoc}
   */
  public function count(): int {
    return count($this->spoolRows);
  }

  /**
   * {@inheritdoc}
   */
  public function nextMail() {
    // Get the current mail spool row.
    $spool_data = current($this->spoolRows);
    // If we're done, return false.
    if (!$spool_data) {
      return FALSE;
    }

    $issue = \Drupal::entityTypeManager()
      ->getStorage($spool_data->entity_type)
      ->load($spool_data->entity_id);
    if (!$issue) {
      // Skip if the entity load failed.
      $this->setLastMailResult(SpoolStorageInterface::STATUS_SKIPPED);
      return $this->nextMail();
    }

    if (!empty($spool_data->data)) {
      $subscriber = Subscriber::create(unserialize($spool_data->data));
    }
    else {
      $subscriber = Subscriber::load($spool_data->snid);
    }

    if (!$subscriber || !$subscriber->getMail()) {
      // Skip if loading the subscriber failed or no email is available.
      $this->setLastMailResult(SpoolStorageInterface::STATUS_SKIPPED);
      return $this->nextMail();
    }

    $mail = new MailEntity($issue, $subscriber, \Drupal::service('simplenews.mail_cache'));

    // Set the langcode.
    $spool_data->langcode = $mail->getLanguage();
    return $mail;
  }

  /**
   * {@inheritdoc}
   */
  public function setLastMailResult($result) {
    $spool_data = current($this->spoolRows);
    $spool_data->result = $result;

    if ($result == SpoolStorageInterface::STATUS_PENDING) {
      $this->pendingErrors[] = $spool_data->msid;
      $this->consecutivePendingErrors++;
      if ($this->consecutivePendingErrors > static::MAX_ERRORS) {
        throw new AbortSendingException('Maximum error limit exceeded');
      }
    }

    // Update the spool entry. We can't batch this part up as that would lead
    // to duplicate emails in case of PHP execution time overrun.
    $this->spoolStorage->updateMails([$spool_data->msid], $result);

    if ($result == SpoolStorageInterface::STATUS_DONE) {
      // We have successfully sent a mail so there is not a global transport
      // error.  Reset the count of consecutive errors.
      $this->consecutivePendingErrors = 0;
      $this->success = TRUE;
    }

    next($this->spoolRows);
  }

  /**
   * {@inheritdoc}
   */
  public function getResults() {
    if ($this->success && $this->pendingErrors) {
      // At least one mail was sent successfully so we can assume there is not
      // a global transport failure. Mark any 'unclassified' errors
      // (SpoolStorageInterface::STATUS_PENDING) as failed.
      $this->spoolStorage->updateMails($this->pendingErrors, SpoolStorageInterface::STATUS_FAILED);
      foreach ($this->pendingErrors as $msid) {
        $this->spoolRows[$msid]->result = SpoolStorageInterface::STATUS_FAILED;
      }
    }

    if ($msid = key($this->spoolRows)) {
      // The loop didn't finish so clear any rows that don't have a result.
      $spool_ids = array_keys($this->spoolRows);
      $offset = array_search($msid, $spool_ids);
      $this->spoolStorage->updateMails(array_slice($spool_ids, $offset), SpoolStorageInterface::STATUS_PENDING);
      $this->spoolRows = array_slice($this->spoolRows, 0, $offset);
    }

    return $this->spoolRows;
  }

}
