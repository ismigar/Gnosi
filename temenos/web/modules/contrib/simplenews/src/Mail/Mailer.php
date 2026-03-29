<?php

namespace Drupal\simplenews\Mail;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Mail\MailManagerInterface;
use Drupal\Core\Messenger\MessengerTrait;
use Drupal\Core\Session\AccountSwitcherInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\State\StateInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\node\Entity\Node;
use Drupal\simplenews\AbortSendingException;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\SkipMailException;
use Drupal\simplenews\Spool\SpoolStorageInterface;
use Drupal\simplenews\SubscriberInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Header\MailboxHeader;

/**
 * Default Mailer.
 */
class Mailer implements MailerInterface {

  use MessengerTrait;
  use StringTranslationTrait;

  /**
   * Amount of mails after which the execution time should be checked again.
   */
  const SEND_CHECK_INTERVAL = 100;

  /**
   * At 80% of the PHP max execution time, sending is interrupted.
   */
  const SEND_TIME_LIMIT = 0.8;

  /**
   * Array indicating which status values to track results for.
   */
  const TRACK_RESULTS = [
    SpoolStorageInterface::STATUS_DONE => TRUE,
    SpoolStorageInterface::STATUS_FAILED => TRUE,
  ];

  /**
   * The simplenews spool storage.
   *
   * @var \Drupal\simplenews\Spool\SpoolStorageInterface
   */
  protected $spoolStorage;

  /**
   * The mail manager.
   *
   * @var \Drupal\Core\Mail\MailManagerInterface
   */
  protected $mailManager;

  /**
   * State service.
   *
   * @var \Drupal\Core\State\StateInterface
   */
  protected $state;

  /**
   * A logger instance.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected $logger;

  /**
   * Account switcher.
   *
   * @var \Drupal\Core\Session\AccountSwitcherInterface
   */
  protected $accountSwitcher;

  /**
   * Lock service.
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
   * Start time of the timer.
   *
   * @var float
   */
  protected $startTime;

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The language manager.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;

  /**
   * The simplenews mail cache.
   *
   * @var \Drupal\simplenews\Mail\MailCacheInterface
   */
  protected $mailCache;

  /**
   * The module handler.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * Constructs a Mailer.
   *
   * @param \Drupal\simplenews\Spool\SpoolStorageInterface $spool_storage
   *   The simplenews spool storage.
   * @param \Drupal\Core\Mail\MailManagerInterface $mail_manager
   *   The mail manager.
   * @param \Drupal\Core\State\StateInterface $state
   *   State service.
   * @param \Psr\Log\LoggerInterface $logger
   *   A logger instance.
   * @param \Drupal\Core\Session\AccountSwitcherInterface $account_switcher
   *   Account switcher.
   * @param \Drupal\Core\Lock\LockBackendInterface $lock
   *   Lock service.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager service.
   * @param \Drupal\Core\Language\LanguageManagerInterface $language_manager
   *   The language manager.
   * @param \Drupal\simplenews\Mail\MailCacheInterface $mail_cache
   *   The simplenews mail cache.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler.
   */
  public function __construct(SpoolStorageInterface $spool_storage, MailManagerInterface $mail_manager, StateInterface $state, LoggerInterface $logger, AccountSwitcherInterface $account_switcher, LockBackendInterface $lock, ConfigFactoryInterface $config_factory, EntityTypeManagerInterface $entity_type_manager, LanguageManagerInterface $language_manager, MailCacheInterface $mail_cache, ModuleHandlerInterface $module_handler) {
    $this->spoolStorage = $spool_storage;
    $this->mailManager = $mail_manager;
    $this->state = $state;
    $this->logger = $logger;
    $this->accountSwitcher = $account_switcher;
    $this->lock = $lock;
    $this->config = $config_factory->get('simplenews.settings');
    $this->entityTypeManager = $entity_type_manager;
    $this->languageManager = $language_manager;
    $this->mailCache = $mail_cache;
    $this->moduleHandler = $module_handler;
  }

  /**
   * {@inheritdoc}
   */
  public function attemptImmediateSend(array $conditions = [], $use_batch = TRUE) {
    if ($this->config->get('mail.use_cron')) {
      return FALSE;
    }
    if ($use_batch) {
      // Set up as many send operations as necessary to send all mails with the
      // defined throttle amount.
      $throttle = $this->config->get('mail.throttle');
      $spool_count = $this->spoolStorage->countMails($conditions);
      $num_operations = ceil($spool_count / $throttle);

      $operations = [];
      for ($i = 0; $i < $num_operations; $i++) {
        $operations[] = [
          '_simplenews_batch_dispatcher',
          ['simplenews.mailer:sendSpool', $throttle, $conditions],
        ];
      }

      // Add separate operations to clear the spool and update the send status.
      $operations[] = ['_simplenews_batch_dispatcher', ['simplenews.spool_storage:clear']];
      $operations[] = ['_simplenews_batch_dispatcher', ['simplenews.mailer:updateSendStatus']];

      $batch = [
        'operations' => $operations,
        'title' => $this->t('Sending mails'),
      ];
      batch_set($batch);
    }
    else {
      // Send everything that matches the conditions immediately.
      $this->sendSpool(SpoolStorageInterface::UNLIMITED, $conditions);
      $this->spoolStorage->clear();
      $this->updateSendStatus();
    }
    return TRUE;
  }

  /**
   * {@inheritdoc}
   */
  public function sendSpool($limit = SpoolStorageInterface::UNLIMITED, array $conditions = []) {
    $check_counter = 0;

    // Send pending messages from database cache.
    $spool = $this->spoolStorage->getMails($limit, $conditions);
    if (count($spool) > 0) {

      // Switch to the anonymous user.
      $anonymous_user = new AnonymousUserSession();
      $this->accountSwitcher->switchTo($anonymous_user);

      $count_fail = $count_skipped = $count_success = 0;
      $sent = [];

      $this->startTimer();

      try {
        while ($mail = $spool->nextMail()) {
          $mail->setKey('node');
          $result = $this->sendMail($mail);
          $spool->setLastMailResult($result);

          // Check every n emails if we exceed the limit.
          // When PHP maximum execution time is almost elapsed we interrupt
          // sending. The remainder will be sent during the next cron run.
          if (++$check_counter >= static::SEND_CHECK_INTERVAL && ini_get('max_execution_time') > 0) {
            $check_counter = 0;
            // Stop sending if a percentage of max execution time was exceeded.
            $elapsed = $this->getCurrentExecutionTime();
            if ($elapsed > static::SEND_TIME_LIMIT * ini_get('max_execution_time')) {
              $this->logger->warning('Sending interrupted: PHP maximum execution time almost exceeded. Remaining newsletters will be sent during the next cron run. If this warning occurs regularly you should reduce the <a href=":cron_throttle_setting">Cron throttle setting</a>.', [
                ':cron_throttle_setting' => Url::fromRoute('simplenews.settings_mail')->toString(),
              ]);
              break;
            }
          }
        }
      }
      catch (AbortSendingException $e) {
        $this->logger->error($e->getMessage());
      }

      // Calculate counts.
      $results_table = [];
      $freq = array_fill(0, SpoolStorageInterface::STATUS_FAILED + 1, 0);
      foreach ($spool->getResults() as $row) {
        $freq[$row->result]++;
        if (isset(static::TRACK_RESULTS[$row->result])) {
          $item = &$results_table[$row->entity_type][$row->entity_id][$row->result];
          $item = ($item ?? 0) + 1;
        }
      }

      // Update subscriber count.
      if ($this->lock->acquire('simplenews_update_sent_count')) {
        foreach ($results_table as $entity_type => $ids) {
          $storage = $this->entityTypeManager->getStorage($entity_type);

          foreach ($ids as $entity_id => $counts) {
            $storage->resetCache([$entity_id]);
            $entity = $storage->load($entity_id);
            $entity->simplenews_issue->sent_count += $counts[SpoolStorageInterface::STATUS_DONE] ?? 0;
            $entity->simplenews_issue->error_count += $counts[SpoolStorageInterface::STATUS_FAILED] ?? 0;
            $entity->save();
          }
        }
        $this->lock->release('simplenews_update_sent_count');
      }

      // Report sent result and elapsed time. On Windows systems getrusage() is
      // not implemented and hence no elapsed time is available.
      $log_array = [
        '%success' => $freq[SpoolStorageInterface::STATUS_DONE],
        '%skipped' => $freq[SpoolStorageInterface::STATUS_SKIPPED],
        '%fail' => $freq[SpoolStorageInterface::STATUS_FAILED],
        '%retry' => $freq[SpoolStorageInterface::STATUS_PENDING],
      ];

      if (function_exists('getrusage')) {
        $log_array['%sec'] = round($this->getCurrentExecutionTime(), 1);
        $this->logger->notice('%success emails sent in %sec seconds, %skipped skipped, %fail failed permanently, %retry failed retrying.', $log_array);
      }
      else {
        $this->logger->notice('%success emails sent, %skipped skipped, %fail failed permanently, %retry failed retrying.', $log_array);
      }

      $this->state->set('simplenews.last_cron', \Drupal::time()->getRequestTime());
      $this->state->set('simplenews.last_sent', $freq[SpoolStorageInterface::STATUS_DONE]);

      $this->accountSwitcher->switchBack();
      return $freq[SpoolStorageInterface::STATUS_DONE];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function sendMail(MailInterface $mail) {
    $params['simplenews_mail'] = $mail;
    if ($mail->getKey() == 'node') {
      // Suppress error message as it causes cron failures.
      $params['_error_message'] = FALSE;
    }

    // Send mail.
    try {
      $message = $this->mailManager->mail('simplenews', $mail->getKey(), $mail->getRecipient(), $mail->getLanguage(), $params, $mail->getFromFormatted());

      // Log sent result in watchdog.
      if ($this->config->get('mail.debug')) {
        if ($message['result']) {
          $this->logger->debug('Outgoing email. Message type: %type<br />Subject: %subject<br />Recipient: %to', [
            '%type' => $mail->getKey(),
            '%to' => $message['to'],
            '%subject' => $message['subject'],
          ]);
        }
        else {
          $this->logger->error('Outgoing email failed. Message type: %type<br />Subject: %subject<br />Recipient: %to', [
            '%type' => $mail->getKey(),
            '%to' => $message['to'],
            '%subject' => $message['subject'],
          ]);
        }
      }

      // By default, failures are left in PENDING state to retry.
      $result = ($message['result'] === FALSE) ? SpoolStorageInterface::STATUS_PENDING : SpoolStorageInterface::STATUS_DONE;
      $this->moduleHandler->alter('simplenews_mail_result', $result, $message);
    }
    catch (SkipMailException $e) {
      $result = SpoolStorageInterface::STATUS_SKIPPED;
    }

    return $result;
  }

  /**
   * {@inheritdoc}
   */
  public function sendTest(ContentEntityInterface $issue, array $test_addresses, string $key = 'test') {
    // Force the current user to anonymous to ensure consistent permissions.
    $this->accountSwitcher->switchTo(new AnonymousUserSession());

    // Send the test newsletter to the test address(es) specified in the node.
    // Build array of test email addresses.
    // Send newsletter to test addresses.
    // Emails are send direct, not using the spool.
    $recipients = ['anonymous' => [], 'user' => []];
    foreach ($test_addresses as $mail) {
      $mail = trim($mail);
      if (!empty($mail)) {
        $subscriber = Subscriber::loadByMail($mail, 'create', $this->languageManager->getCurrentLanguage()->getId());

        if ($account = $subscriber->getUser()) {
          $recipients['user'][] = $account->getDisplayName() . ' <' . $mail . '>';
        }
        else {
          $recipients['anonymous'][] = $mail;
        }
        $mail = new MailEntity($issue, $subscriber, $this->mailCache);
        $mail->setKey($key);
        $this->sendMail($mail);
      }
    }
    if (count($recipients['user'])) {
      $recipients_txt = implode(', ', $recipients['user']);
      $this->messenger()->addMessage($this->t('Test newsletter sent to user %recipient.', ['%recipient' => $recipients_txt]));
    }
    if (count($recipients['anonymous'])) {
      $recipients_txt = implode(', ', $recipients['anonymous']);
      $this->messenger()->addMessage($this->t('Test newsletter sent to anonymous %recipient.', ['%recipient' => $recipients_txt]));
    }

    $this->accountSwitcher->switchBack();
  }

  /**
   * {@inheritdoc}
   */
  public function sendSubscribeConfirmation(SubscriberInterface $subscriber) {
    $params['from'] = $this->getFrom();
    $params['context']['simplenews_subscriber'] = $subscriber;
    $key = 'subscribe_combined';
    $this->mailManager->mail('simplenews', $key, $subscriber->getMail(), $subscriber->getLangcode(), $params, $params['from']['address']);
  }

  /**
   * {@inheritdoc}
   */
  public function updateSendStatus() {
    // For each pending newsletter count pending emails in the spool.
    // If 0, update status to send-ready.
    $query = \Drupal::entityQuery('node');
    $nids = $query
      ->condition('simplenews_issue.status', SIMPLENEWS_STATUS_SEND_PENDING)
      ->accessCheck(FALSE)
      ->execute();
    $nodes = Node::loadMultiple($nids);
    foreach ($nodes as $nid => $node) {
      $count = $this->spoolStorage->countMails(['entity_id' => $nid, 'entity_type' => 'node']);
      if ($count == 0) {
        $node->simplenews_issue->status = SIMPLENEWS_STATUS_SEND_READY;
        $node->save();
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getFrom() {
    $address = $this->config->get('newsletter.from_address');
    $name = $this->config->get('newsletter.from_name');

    $mailbox = new MailboxHeader('From', new Address($address, $name));

    // Windows based PHP systems don't accept formatted email addresses.
    $formatted_address = (mb_substr(PHP_OS, 0, 3) == 'WIN') ? $address : $mailbox->getBodyAsString();

    return [
      'address' => $address,
      'formatted' => $formatted_address,
    ];
  }

  /**
   * Starts the execution timer.
   */
  protected function startTimer() {
    // Windows systems don't implement getrusage(). There is no alternative.
    if (!function_exists('getrusage')) {
      return;
    }

    $usage = getrusage();
    $this->startTime = (float) ($usage['ru_stime.tv_sec'] . '.' . $usage['ru_stime.tv_usec']) + (float) ($usage['ru_utime.tv_sec'] . '.' . $usage['ru_utime.tv_usec']);
  }

  /**
   * Returns the current execution time.
   *
   * @return float|null
   *   The elapsed PHP execution time since the last start.
   *
   * @see self::startTime()
   */
  protected function getCurrentExecutionTime() {
    // Windows systems don't implement getrusage(). There is no alternative.
    if (!function_exists('getrusage')) {
      return NULL;
    }

    $usage = getrusage();
    $now = (float) ($usage['ru_stime.tv_sec'] . '.' . $usage['ru_stime.tv_usec']) + (float) ($usage['ru_utime.tv_sec'] . '.' . $usage['ru_utime.tv_usec']);

    return $now - $this->startTime;
  }

}
