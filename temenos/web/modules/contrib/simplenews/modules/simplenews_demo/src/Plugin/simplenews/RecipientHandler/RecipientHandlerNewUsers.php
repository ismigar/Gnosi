<?php

namespace Drupal\simplenews_demo\Plugin\simplenews\RecipientHandler;

use Drupal\simplenews\Plugin\simplenews\RecipientHandler\RecipientHandlerEntityBase;

/**
 * This handler sends to all active users that have never logged in.
 *
 * @RecipientHandler(
 *   id = "simplenews_new_users",
 *   title = @Translation("New users")
 * )
 */
class RecipientHandlerNewUsers extends RecipientHandlerEntityBase {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery() {
    return \Drupal::entityQuery('user')
      ->exists('mail')
      ->condition('access', 0)
      ->accessCheck(FALSE)
      ->condition('status', TRUE);
  }

  /**
   * {@inheritdoc}
   */
  protected function cacheCount() {
    return TRUE;
  }

}
