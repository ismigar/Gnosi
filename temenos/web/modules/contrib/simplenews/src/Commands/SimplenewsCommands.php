<?php

namespace Drupal\simplenews\Commands;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\simplenews\Mail\MailerInterface;
use Drupal\simplenews\Spool\SpoolStorageInterface;
use Drush\Commands\DrushCommands;
use Psr\Log\LogLevel;

/**
 * A Drush commandfile.
 *
 * In addition to this file, you need a drush.services.yml
 * in root of your module, and a composer.json file that provides the name
 * of the services file to use.
 *
 * See these files for an example of injecting Drupal services:
 *   - http://cgit.drupalcode.org/devel/tree/src/Commands/DevelCommands.php
 *   - http://cgit.drupalcode.org/devel/tree/drush.services.yml
 */
class SimplenewsCommands extends DrushCommands {

  /**
   * The simplenews config.
   *
   * @var \Drupal\Core\Config\ImmutableConfig
   */
  protected $simplenewsConfig;

  /**
   * The spool storage.
   *
   * @var \Drupal\simplenews\Spool\SpoolStorageInterface
   */
  protected $spoolStorage;

  /**
   * The mailer service.
   *
   * @var \Drupal\simplenews\Mail\MailerInterface
   */
  protected $mailer;

  /**
   * SimplenewsCommands constructor.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   * @param \Drupal\simplenews\Spool\SpoolStorageInterface $spool_storage
   *   The spool storage.
   * @param \Drupal\simplenews\Mail\MailerInterface $mailer
   *   The mailer service.
   */
  public function __construct(ConfigFactoryInterface $config_factory, SpoolStorageInterface $spool_storage, MailerInterface $mailer) {
    parent::__construct();
    $this->simplenewsConfig = $config_factory->get('simplenews.settings');
    $this->spoolStorage = $spool_storage;
    $this->mailer = $mailer;
  }

  /**
   * Print the current simplenews mail spool count.
   *
   * @param array $options
   *   An associative array of options whose values come from cli, aliases,
   *   config, etc.
   *
   * @validate-module-enabled simplenews
   *
   * @command simplenews:spool-count
   * @aliases sn-sc,simplenews-spool-count
   */
  public function spoolCount(array $options) {
    $count = $this->spoolStorage->countMails();

    $no_description = $options['pipe'];
    if ($no_description) {
      $this->output()->writeln($count);
    }
    else {
      $this->logger()->notice(dt('Current simplenews mail spool count: @count', ['@count' => $count]));
    }
  }

  /**
   * Send the defined amount of mail spool entries.
   *
   * @param int|bool $limit
   *   Number of mails to send. 0 sends all emails. If not specified, will be
   *   set to the value of the mail.throttle in the module settings config.
   * @param array $options
   *   An associative array of options whose values come from cli, aliases,
   *   config, etc.
   *
   * @usage drush sn-ss
   *   Send the default amount of mails, as defined by the mail.throttle
   *   settings.
   * @usage drush sn-ss 0
   *   Send all mails.
   * @usage drush sn-ss 100
   *   Send 100 mails.
   *
   * @validate-module-enabled simplenews
   *
   * @command simplenews:spool-send
   * @aliases sn-ss,simplenews-spool-send
   *
   * @throws \Exception
   */
  public function spoolSend($limit = FALSE, array $options = ['pipe' => FALSE]) {
    if (!simplenews_assert_uri()) {
      throw new \Exception('Site URI not specified, use --uri.');
    }

    if ($limit === FALSE) {
      $limit = $this->simplenewsConfig->get('mail.throttle');
    }
    elseif ($limit == 0) {
      $limit = SpoolStorageInterface::UNLIMITED;
    }

    $start_time = microtime(TRUE);

    $sent = $this->mailer->sendSpool($limit);
    $this->spoolStorage->clear();
    $this->mailer->updateSendStatus();

    $durance = round(microtime(TRUE) - $start_time, 2);

    // Report the number of sent mails.
    if ($sent > 0) {
      $remaining = $this->spoolStorage->countMails();
      if ($options['pipe']) {
        // For pipe, print the sent first and then the remaining count,
        // separated by a space.
        $this->output()->writeln($sent . " " . $remaining);
      }
      else {
        $this->logger()->log(LogLevel::INFO, dt('Sent @count mails from the queue in @sec seconds.', ['@count' => $sent, '@sec' => $durance]));
        $this->logger()->log(LogLevel::INFO, dt('Remaining simplenews mail spool count: @count', ['@count' => $remaining]));
      }
    }
  }

}
