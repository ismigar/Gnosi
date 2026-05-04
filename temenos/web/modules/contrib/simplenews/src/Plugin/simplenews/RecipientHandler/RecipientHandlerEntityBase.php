<?php

namespace Drupal\simplenews\Plugin\simplenews\RecipientHandler;

/**
 * Base for Recipient Handler classes based on EntityQuery.
 */
abstract class RecipientHandlerEntityBase extends RecipientHandlerBase {

  /**
   * {@inheritdoc}
   */
  public function addToSpool() {
    $query = $this->buildEntityQuery();
    $ids = $query->execute();
    $field = ($query->getEntityTypeId() == 'user') ? 'uid' : 'snid';
    $this->addArrayToSpool($field, $ids);
    return count($ids);
  }

  /**
   * {@inheritdoc}
   */
  protected function doCount() {
    return $this->buildEntityQuery()->count()->execute();
  }

  /**
   * Build the query that gets the list of subscribers.
   *
   * @return \Drupal\Core\Entity\Query\QueryInterface
   *   Entity query on 'simplenews_subscriber' or 'user'.
   */
  abstract protected function buildEntityQuery();

}
