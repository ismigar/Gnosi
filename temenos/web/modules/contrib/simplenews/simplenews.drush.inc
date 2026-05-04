<?php

/**
 * @file
 * Drush commands for administer Simplenews.
 */

use Drupal\simplenews\Spool\SpoolStorageInterface;

/**
 * Implements hook_drush_command().
 */
function simplenews_drush_command() {
  $items = [];

  $items['simplenews-spool-count'] = [
    'description' => 'Print the current simplenews mail spool count',
    'aliases' => ['sn-sc'],
    'drupal dependencies' => ['simplenews'],
    'options' => [
      'pipe' => dt('Just print the count value to allow parsing'),
    ],
  ];

  $items['simplenews-spool-send'] = [
    'description' => 'Send the defined amount of mail spool entries.',
    'examples' => [
      'drush sn-ss' => dt('Send the default amount of mails, as defined by the mail.throttle settings.'),
      'drush sn-ss 0' => dt('Send all mails.'),
      'drush sn-ss 100' => dt('Send 100 mails.'),
    ],
    'options' => [
      'limit' => dt('Number of mails to send. 0 sends all emails. If not specified, will be set to the value of the mail.throttle in the module settings config.'),
      'pipe' => dt('Just print the sent and remaining count on separate lines to allow parsing'),
    ],
    'aliases' => ['sn-ss'],
    'drupal dependencies' => ['simplenews'],
  ];

  return $items;
}

/**
 * Drush command to count the mail spool queue.
 */
function drush_simplenews_spool_count() {

  $count = \Drupal::service('simplenews.spool_storage')->countMails();

  $no_description = drush_get_option(['p', 'pipe']);
  if ($no_description) {
    drush_print_pipe($count);
  }
  else {
    \Drupal::logger('simplenews')->status('Current simplenews mail spool count: @count', ['@count' => $count]);
  }
}

/**
 * Drush command to send the mail spool queue.
 */
function drush_simplenews_spool_send($limit = FALSE) {
  if (!simplenews_assert_uri()) {
    drush_set_error('Site URI not specified, use --uri.');
    return;
  }

  if ($limit === FALSE) {
    $limit = \Drupal::config('simplenews.settings')->get('mail.throttle');
  }
  elseif ($limit == 0) {
    $limit = SpoolStorageInterface::UNLIMITED;
  }

  $start_time = microtime(TRUE);

  $sent = \Drupal::service('simplenews.mailer')->sendSpool($limit);
  \Drupal::service('simplenews.spool_storage')->clear();
  \Drupal::service('simplenews.mailer')->updateSendStatus();

  $durance = round(microtime(TRUE) - $start_time, 2);

  // Report the number of sent mails.
  if ($sent > 0) {
    $remaining = \Drupal::service('simplenews.spool_storage')->countMails();
    if (drush_get_option(['p', 'pipe'])) {
      // For pipe, print the sent first and then the remaining count, separated
      // by a space.
      drush_print_pipe($sent . " " . $remaining);
    }
    else {
      \Drupal::logger('simplenews')->status('Sent @count mails from the queue in @sec seconds.', ['@count' => $sent, '@sec' => $durance]);
      \Drupal::logger('simplenews')->status('Remaining simplenews mail spool count: @count', ['@count' => $remaining]);
    }
  }

}
