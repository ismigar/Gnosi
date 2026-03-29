<?php

namespace Drupal\simplenews\Subscription;

use Drupal\Core\Database\Database;
use Drupal\Core\Entity\Sql\SqlContentEntityStorage;
use Drupal\simplenews\SubscriberInterface;

/**
 * Default subscription storage.
 */
class SubscriptionStorage extends SqlContentEntityStorage implements SubscriptionStorageInterface {

  /**
   * {@inheritdoc}
   */
  public function deleteSubscriptions(array $conditions = []) {

    $table_name = 'simplenews_subscriber__subscriptions';
    if (!Database::getConnection()->schema()->tableExists($table_name)) {
      // This can happen if this is called during uninstall.
      return;
    }
    $query = $this->database->delete($table_name);
    foreach ($conditions as $key => $condition) {
      $query->condition($key, $condition);
    }
    $query->execute();
    $this->resetCache();
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscriptionsByNewsletter($newsletter_id) {
    $query = $this->database->select('simplenews_subscriber', 'sn');
    $query->innerJoin('simplenews_subscriber__subscriptions', 'ss', 'ss.entity_id = sn.id');
    $query->fields('sn', ['mail', 'uid', 'langcode', 'id'])
      ->condition('sn.status', SubscriberInterface::ACTIVE)
      ->condition('ss.subscriptions_target_id', $newsletter_id);
    return $query->execute()->fetchAllAssoc('mail');
  }

}
