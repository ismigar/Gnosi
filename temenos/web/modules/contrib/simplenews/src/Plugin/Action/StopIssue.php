<?php

namespace Drupal\simplenews\Plugin\Action;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Action\ActionBase;
use Drupal\Core\Session\AccountInterface;

/**
 * Stops a newsletter issue.
 *
 * @Action(
 *   id = "simplenews_stop_action",
 *   label = @Translation("Stop sending"),
 *   type = "node"
 * )
 */
class StopIssue extends ActionBase {

  /**
   * {@inheritdoc}
   */
  public function execute($node = NULL) {
    \Drupal::service('simplenews.spool_storage')->deleteIssue($node);
  }

  /**
   * {@inheritdoc}
   */
  public function access($node, ?AccountInterface $account = NULL, $return_as_object = FALSE) {

    if ($node->hasField('simplenews_issue') && $node->simplenews_issue->target_id != NULL) {
      return AccessResult::allowedIfHasPermission($account, 'administer newsletters')
        ->orIf(AccessResult::allowedIfHasPermission($account, 'send newsletter'));
    }
    return AccessResult::neutral();
  }

}
