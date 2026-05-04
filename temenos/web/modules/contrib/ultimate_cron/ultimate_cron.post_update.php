<?php

/**
 * @file
 * Post update functions for Ultimate Cron.
 */

use Drupal\ultimate_cron\Entity\CronJob;


/**
 * Convert cron jobs to the new custom hook callback format.
 */
function ultimate_cron_post_update_hook_callbacks() {
  $jobs = CronJob::loadMultiple();

  // Convert cron jobs to the custom hook callback format.
  foreach ($jobs as $job) {
    if ($job->getCallback() === $job->getModule() . '_cron') {
      $job->setCallback($job->getModule() . '#cron');
      $job->save();
    }
  }
}
