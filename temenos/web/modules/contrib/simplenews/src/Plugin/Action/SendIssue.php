<?php

namespace Drupal\simplenews\Plugin\Action;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Action\ActionBase;
use Drupal\Core\Session\AccountInterface;

/**
 * Sends a newsletter issue.
 *
 * @Action(
 *   id = "simplenews_send_action",
 *   label = @Translation("Send newsletter issue"),
 *   type = "node"
 * )
 */
class SendIssue extends ActionBase {

  /**
   * {@inheritdoc}
   */
  public function execute($node = NULL) {
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
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
