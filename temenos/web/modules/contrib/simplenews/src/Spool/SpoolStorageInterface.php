<?php

namespace Drupal\simplenews\Spool;

use Drupal\Core\Entity\ContentEntityInterface;

/**
 * The spool storage manages a queue of mails that need to be sent.
 */
interface SpoolStorageInterface {

  /**
   * On Hold.
   */
  const STATUS_HOLD = 0;

  /**
   * Pending, or retrying failure.
   */
  const STATUS_PENDING = 1;

  /**
   * Done, sent successfully.
   */
  const STATUS_DONE = 2;

  /**
   * In progress and locked until expired.
   */
  const STATUS_IN_PROGRESS = 3;

  /**
   * Skipped (not sent, but done).
   */
  const STATUS_SKIPPED = 4;

  /**
   * Failed, not retrying.
   */
  const STATUS_FAILED = 5;

  /**
   * Used when sending an unlimited amount of mails from the spool.
   */
  const UNLIMITED = -1;

  /**
   * This function allocates mails to be sent in current run.
   *
   * Drupal acquire_lock guarantees that no concurrency issue happened.
   * Messages with status SpoolStorageInterface::STATUS_IN_PROGRESS will only
   * be returned if the maximum send time has expired.
   *
   * @param int $limit
   *   (Optional) The maximum number of mails to load from the spool. Defaults
   *   to unlimited.
   * @param array $conditions
   *   (Optional) Array of conditions which are applied to the query. If not
   *   set, status defaults to SpoolStorageInterface::STATUS_PENDING,
   *   SpoolStorageInterface::STATUS_IN_PROGRESS.
   *
   * @return \Drupal\simplenews\Spool\SpoolListInterface
   *   A mail spool list.
   */
  public function getMails($limit = self::UNLIMITED, array $conditions = []);

  /**
   * Update status of mail data in spool table.
   *
   * Time stamp is set to current time.
   *
   * @param array $msids
   *   Array of Mail spool ids to be updated.
   * @param int $status
   *   One of the SpoolStorageInterface::STATUS_* constants.
   */
  public function updateMails(array $msids, $status);

  /**
   * Count data in mail spool table.
   *
   * @param array $conditions
   *   (Optional) Array of conditions which are applied to the query. If not
   *   set, status defaults to SpoolStorageInterface::STATUS_PENDING,
   *   SpoolStorageInterface::STATUS_IN_PROGRESS.
   *
   * @return int
   *   Count of mail spool elements of the passed in arguments.
   */
  public function countMails(array $conditions = []);

  /**
   * Remove old records from mail spool table.
   *
   * All records with status 'send' and time stamp before the expiration date
   * are removed from the spool.
   *
   * @return int
   *   Number of deleted spool rows.
   */
  public function clear();

  /**
   * Remove records from mail spool table according to the conditions.
   *
   * @return int
   *   Count deleted
   */
  public function deleteMails(array $conditions);

  /**
   * Adds a newsletter issue to the mail spool.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $issue
   *   The newsletter issue to be sent.
   */
  public function addIssue(ContentEntityInterface $issue);

  /**
   * Deletes a newsletter issue from the mail spool.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $issue
   *   The newsletter issue to be deleted.
   */
  public function deleteIssue(ContentEntityInterface $issue);

  /**
   * Save mail message in mail cache table.
   *
   * @param array $spool
   *   The message to be stored in the spool table, as an array containing the
   *   following keys:
   *   - entity_type
   *   - entity_id
   *   - newsletter_id
   *   - snid or data
   *   - status: (optional) Defaults to SpoolStorageInterface::STATUS_PENDING
   *   - time: (optional) Defaults to REQUEST_TIME.
   */
  public function addMail(array $spool);

  /**
   * Builds a recipient handler class for a given newsletter issue.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $issue
   *   The newsletter issue to be sent.
   * @param array $edited_values
   *   (optional) Modified values, if called from an edit form.
   * @param bool $return_options
   *   (optional, defaults to FALSE) If set, also return the set of valid
   *   options for choice of recipient handler.
   *
   * @return \Drupal\simplenews\RecipientHandler\RecipientHandlerInterface|array
   *   A constructed recipient handler plugin.  If $return_options is set then
   *   the return is an array of two items: the recipient handler plugin and
   *   the result of RecipientHandlerManager::getOptions().
   *
   * @throws \Exception
   *   If the handler class does not exist.
   */
  public function getRecipientHandler(ContentEntityInterface $issue, ?array $edited_values = NULL, $return_options = FALSE);

  /**
   * Returns a summary of key newsletter issue parameters.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $issue
   *   The newsletter issue entity.
   *
   * @return array
   *   An array containing the following elements:
   *   - count: total number of emails that will be sent or have been sent.
   *   - sent_count: number of emails sent.
   *   - error_count: number of send errors.
   *   - description: readable description of status and email counts.
   */
  public function issueSummary(ContentEntityInterface $issue);

  /**
   * Returns a count of the recipients for a newsletter issue.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $issue
   *   The newsletter issue entity.
   *
   * @return int
   *   Count of recipients.
   */
  public function issueCountRecipients(ContentEntityInterface $issue);

}
