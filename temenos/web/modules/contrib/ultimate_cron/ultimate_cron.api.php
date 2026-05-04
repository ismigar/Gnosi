<?php
/**
 * @file
 * Hooks provided by Ultimate Cron.
 */
use Drupal\ultimate_cron\Entity\CronJob;

/**
 * @addtogroup hooks
 * @{
 */

/**
 * The following hooks are invoked during the jobs life cycle,
 * from schedule to finish. The chronological order is:
 *
 * cron_pre_schedule
 * cron_post_schedule
 * cron_pre_launch
 * cron_pre_launch(*)
 * cron_pre_run
 * cron_post_run
 * cron_post_launch(*)
 *
 * Depending on how the launcher works, the hook_cron_post_launch() may be
 * invoked before or after hook_cron_post_run() or somewhere in between.
 * An example of this is the Background Process launcher, which launches
 * the job in a separate thread. After the launch, hook_cron_post_launch()
 * is invoked, but the run/invoke hooks are invoked simultaneously in a
 * separate thread.
 *
 * All of these hooks can also be implemented inside a plugin as a method.
 */

/**
 * Invoked just before a job is asked for its schedule.
 *
 * @param CronJob $job
 *   The job being queried.
 */
function hook_pre_schedule($job) {
}

/**
 * Invoked after a job has been asked for its schedule.
 *
 * @param CronJob $job
 *   The job being queried.
 */
function hook_post_schedule($job) {
}

/**
 * Invoked just before a job is launched.
 *
 * @param CronJob $job
 *   The job being launched.
 */
function hook_pre_launch($job) {
}

/**
 * Invoked after a job has been launched.
 *
 * @param CronJob $job
 *   The job that was launched.
 */
function hook_post_launch($job) {
}

/**
 * Invoked just before a job is being run.
 *
 * @param CronJob $job
 *   The job being run.
 */
function hook_pre_run($job) {
}

/**
 * Invoked after a job has been run.
 *
 * @param CronJob $job
 *   The job that was run.
 */
function hook_post_run($job) {
}
