<?php

namespace Drupal\simplenews\Subscription;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\Sql\SqlContentEntityStorageSchema;

/**
 * Defines the subscription schema handler.
 */
class SubscriptionStorageSchema extends SqlContentEntityStorageSchema {

  /**
   * {@inheritdoc}
   */
  protected function getEntitySchema(ContentEntityTypeInterface $entity_type, $reset = FALSE) {
    $schema = parent::getEntitySchema($entity_type, $reset);

    if ($data_table = $this->storage->getBaseTable()) {
      // Create indices for loadByMail() and loadByUid().
      $schema[$data_table]['indexes'] += [
        'simplenews_subscriber__loadbymail' => ['mail', 'status'],
        'simplenews_subscriber__loadbyuid' => ['uid', 'status'],
      ];
    }

    return $schema;
  }

}
