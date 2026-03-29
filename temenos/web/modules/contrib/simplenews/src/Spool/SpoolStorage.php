<?php

namespace Drupal\simplenews\Spool;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Messenger\MessengerTrait;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\simplenews\recipientHandler\RecipientHandlerManager;

/**
 * Default database spool storage.
 */
class SpoolStorage implements SpoolStorageInterface {
  use MessengerTrait;
  use StringTranslationTrait;

  /**
   * The database connection.
   *
   * @var \Drupal\Core\Database\Connection
   */
  protected $connection;

  /**
   * The lock.
   *
   * @var \Drupal\Core\Lock\LockBackendInterface
   */
  protected $lock;

  /**
   * The config factory.
   *
   * @var \Drupal\Core\Config\ImmutableConfig
   */
  protected $config;

  /**
   * The module handler.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * The recipient handler manager.
   *
   * @var \Drupal\simplenews\recipientHandler\recipientHandlerManager
   */
  protected $recipientHandlerManager;

  /**
   * Creates a SpoolStorage object.
   *
   * @param \Drupal\Core\Database\Connection $connection
   *   The database connection.
   * @param \Drupal\Core\Lock\LockBackendInterface $lock
   *   The lock.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler.
   * @param \Drupal\simplenews\recipientHandler\RecipientHandlerManager $recipient_handler_manager
   *   The recipient handler manager.
   */
  public function __construct(Connection $connection, LockBackendInterface $lock, ConfigFactoryInterface $config_factory, ModuleHandlerInterface $module_handler, RecipientHandlerManager $recipient_handler_manager) {
    $this->connection = $connection;
    $this->lock = $lock;
    $this->config = $config_factory->get('simplenews.settings');
    $this->moduleHandler = $module_handler;
    $this->recipientHandlerManager = $recipient_handler_manager;
  }

  /**
   * {@inheritdoc}
   */
  public function getMails($limit = self::UNLIMITED, array $conditions = []) {
    $spool_rows = [];

    // Continue to support 'nid' as a condition.
    if (!empty($conditions['nid'])) {
      $conditions['entity_type'] = 'node';
      $conditions['entity_id'] = $conditions['nid'];
      unset($conditions['nid']);
    }

    // Add default status condition if not set.
    if (!isset($conditions['status'])) {
      $conditions['status'] = [SpoolStorageInterface::STATUS_PENDING, SpoolStorageInterface::STATUS_IN_PROGRESS];
    }

    // Special case for the status condition, the in progress actually only
    // includes spool items whose locking time has expired. So this needs to
    // build an OR condition for them.
    $status_or = $this->connection->condition('OR');
    $statuses = is_array($conditions['status']) ? $conditions['status'] : [$conditions['status']];
    foreach ($statuses as $status) {
      if ($status == SpoolStorageInterface::STATUS_IN_PROGRESS) {
        $status_or->condition($this->connection->condition('AND')
          ->condition('status', $status)
          ->condition('s.timestamp', $this->getExpirationTime(), '<')
        );
      }
      else {
        $status_or->condition('status', $status);
      }
    }
    unset($conditions['status']);

    $query = $this->connection->select('simplenews_mail_spool', 's')
      ->fields('s')
      ->condition($status_or)
      ->orderBy('s.timestamp', 'ASC');

    // Add conditions.
    foreach ($conditions as $field => $value) {
      $query->condition($field, $value);
    }

    /* BEGIN CRITICAL SECTION */
    // The semaphore ensures that multiple processes get different mail spool
    // rows so that duplicate messages are not sent.
    if ($this->lock->acquire('simplenews_acquire_mail')) {
      // Fetch mail spool rows.
      if ($limit > 0) {
        $query->range(0, $limit);
      }
      foreach ($query->execute() as $spool_row) {
        $spool_rows[$spool_row->msid] = $spool_row;
      }
      if (count($spool_rows) > 0) {
        // Set the state and the timestamp of the mails.
        $this->updateMails(array_keys($spool_rows), SpoolStorageInterface::STATUS_IN_PROGRESS);
      }

      $this->lock->release('simplenews_acquire_mail');
    }

    /* END CRITICAL SECTION */

    return $this->createSpoolList($spool_rows);
  }

  /**
   * {@inheritdoc}
   */
  public function updateMails(array $msids, $status) {
    $this->connection->update('simplenews_mail_spool')
      ->condition('msid', (array) $msids, 'IN')
      ->fields([
        'status' => $status,
        'timestamp' => \Drupal::time()->getRequestTime(),
      ])
      ->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function countMails(array $conditions = []) {

    // Continue to support 'nid' as a condition.
    if (!empty($conditions['nid'])) {
      $conditions['entity_type'] = 'node';
      $conditions['entity_id'] = $conditions['nid'];
      unset($conditions['nid']);
    }

    // Add default status condition if not set.
    if (!isset($conditions['status'])) {
      $conditions['status'] = [SpoolStorageInterface::STATUS_PENDING, SpoolStorageInterface::STATUS_IN_PROGRESS];
    }

    $query = $this->connection->select('simplenews_mail_spool');
    // Add conditions.
    foreach ($conditions as $field => $value) {
      if ($field == 'status') {
        if (!is_array($value)) {
          $value = [$value];
        }
        $status_or = $this->connection->condition('OR');
        foreach ($value as $status) {
          $status_or->condition('status', $status);
        }
        $query->condition($status_or);
      }
      else {
        $query->condition($field, $value);
      }
    }

    $query->addExpression('COUNT(*)', 'count');

    return (int) $query
      ->execute()
      ->fetchField();
  }

  /**
   * {@inheritdoc}
   */
  public function clear() {

    $expiration_time = \Drupal::time()->getRequestTime() - $this->config->get('mail.spool_expire') * 86400;
    return $this->connection->delete('simplenews_mail_spool')
      ->condition('status', [SpoolStorageInterface::STATUS_DONE, SpoolStorageInterface::STATUS_SKIPPED], 'IN')
      ->condition('timestamp', $expiration_time, '<=')
      ->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function deleteMails(array $conditions) {
    $query = $this->connection->delete('simplenews_mail_spool');

    foreach ($conditions as $condition => $value) {
      $query->condition($condition, $value);
    }
    return $query->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function addIssue(ContentEntityInterface $issue) {
    if (!in_array($issue->simplenews_issue->status, [SIMPLENEWS_STATUS_SEND_NOT, SIMPLENEWS_STATUS_SEND_PUBLISH])) {
      return;
    }

    if (!$issue->isPublished()) {
      $issue->simplenews_issue->status = SIMPLENEWS_STATUS_SEND_PUBLISH;
      $issue->save();
      $this->messenger()->addMessage($this->t('Newsletter issue %title will be sent when published.', ['%title' => $issue->getTitle()]));
      return;
    }

    $recipient_handler = $this->getRecipientHandler($issue);
    $issue->simplenews_issue->subscribers = $recipient_handler->addToSpool();
    $issue->simplenews_issue->sent_count = 0;
    $issue->simplenews_issue->error_count = 0;
    $issue->simplenews_issue->status = SIMPLENEWS_STATUS_SEND_PENDING;

    // Save except if already saving.
    if (!isset($issue->original)) {
      $issue->save();
    }

    // Notify other modules that a newsletter was just spooled.
    $this->moduleHandler->invokeAll('simplenews_spooled', [$issue]);

    // Attempt to send immediately, if configured to do so.
    if (\Drupal::service('simplenews.mailer')->attemptImmediateSend(['entity_type' => $issue->getEntityTypeId(), 'entity_id' => $issue->id()])) {
      $this->messenger()->addMessage($this->t('Newsletter issue %title sent.', ['%title' => $issue->getTitle()]));
    }
    else {
      $this->messenger()->addMessage($this->t('Newsletter issue %title pending.', ['%title' => $issue->getTitle()]));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function deleteIssue(ContentEntityInterface $issue) {
    if (!in_array($issue->simplenews_issue->status, [SIMPLENEWS_STATUS_SEND_PENDING, SIMPLENEWS_STATUS_SEND_PUBLISH])) {
      return;
    }

    $count = $this->deleteMails(['entity_type' => $issue->getEntityTypeId(), 'entity_id' => $issue->id()]);
    $issue->simplenews_issue->status = SIMPLENEWS_STATUS_SEND_NOT;
    $issue->save();

    $this->messenger()->addMessage($this->t('Sending of %title was stopped. @count pending email(s) were deleted.', [
      '%title' => $issue->getTitle(),
      '@count' => $count,
    ]));
  }

  /**
   * {@inheritdoc}
   */
  public function addMail(array $spool) {
    if (!isset($spool['status'])) {
      $spool['status'] = SpoolStorageInterface::STATUS_PENDING;
    }
    if (!isset($spool['timestamp'])) {
      $spool['timestamp'] = \Drupal::time()->getRequestTime();
    }
    if (isset($spool['data'])) {
      $spool['data'] = serialize($spool['data']);
    }

    $this->connection->insert('simplenews_mail_spool')
      ->fields($spool)
      ->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function getRecipientHandler(ContentEntityInterface $issue, ?array $edited_values = NULL, $return_options = FALSE) {
    $field = $issue->get('simplenews_issue');
    $newsletter_ids = $field->isEmpty() ? [] : array_map(function ($i) {
      return $i['target_id'];
    }, $field->getValue());
    $newsletter_id = $edited_values['target_id'] ?? $newsletter_ids[0] ?? NULL;
    $handler = ($edited_values['handler'] ?? $field->handler) ?: 'simplenews_all';

    // Ensure the requested handler is a valid option.
    $options = $this->recipientHandlerManager->getOptions($newsletter_id);
    if (!isset($options[$handler])) {
      reset($options);
      $handler = key($options);
    }

    $handler_settings = $edited_values['handler_settings'] ?? $field->handler_settings;
    $handler_settings['_issue'] = $issue;
    $handler_settings['_newsletter_ids'] = $newsletter_ids;
    $recipient_handler = $this->recipientHandlerManager->createInstance($handler, $handler_settings);

    return $return_options ? [$recipient_handler, $options] : $recipient_handler;
  }

  /**
   * {@inheritdoc}
   */
  public function issueSummary(ContentEntityInterface $issue) {
    $status = $issue->simplenews_issue->status;
    $params['@sent'] = $summary['sent_count'] = (int) $issue->simplenews_issue->sent_count;
    $params['@error'] = $summary['error_count'] = (int) $issue->simplenews_issue->error_count;
    $params['@count'] = $summary['count'] = (int) $issue->simplenews_issue->subscribers;

    if ($status == SIMPLENEWS_STATUS_SEND_READY) {
      $summary['description'] = $this->t('Newsletter issue sent to @sent subscribers, @error errors.', $params);
    }
    elseif ($status == SIMPLENEWS_STATUS_SEND_PENDING) {
      $summary['description'] = $this->t('Newsletter issue is pending, @sent mails sent out of @count, @error errors.', $params);
    }
    else {
      $params['@count'] = $summary['count'] = $this->issueCountRecipients($issue);
      if ($status == SIMPLENEWS_STATUS_SEND_NOT) {
        $summary['description'] = $this->t('Newsletter issue will be sent to @count subscribers.', $params);
      }
      else {
        $summary['description'] = $this->t('Newsletter issue will be sent to @count subscribers on publish.', $params);
      }
    }

    return $summary;
  }

  /**
   * {@inheritdoc}
   */
  public function issueCountRecipients(ContentEntityInterface $issue) {
    return $this->getRecipientHandler($issue)->count();
  }

  /**
   * Returns the expiration time for IN_PROGRESS status.
   *
   * @return int
   *   A unix timestamp. Any IN_PROGRESS messages with a timestamp older than
   *   this will be re-allocated and re-sent.
   */
  protected function getExpirationTime() {
    $timeout = $this->config->get('mail.spool_progress_expiration');
    $expiration_time = \Drupal::time()->getRequestTime() - $timeout;
    return $expiration_time;
  }

  /**
   * Creates an instance of SpoolListInterface.
   *
   * Derived classes can override this to use a different implementation.
   *
   * @param array $spool_rows
   *   List of mail spool rows.
   *
   * @return \Drupal\simplenews\SpoolSpoolListInterface
   *   The spool list.
   */
  protected function createSpoolList(array $spool_rows) {
    return new SpoolList($spool_rows, $this);
  }

}
