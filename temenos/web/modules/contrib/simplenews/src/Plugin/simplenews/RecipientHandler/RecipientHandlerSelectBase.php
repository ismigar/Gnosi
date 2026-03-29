<?php

namespace Drupal\simplenews\Plugin\simplenews\RecipientHandler;

use Drupal\simplenews\Spool\SpoolStorageInterface;

/**
 * Base for Recipient Handlers that access the database directly using Select.
 *
 * Derivatives access the underlying database directly use a Select query.
 * This is very fast, but won't work with custom storage and can lead to more
 * complex queries.
 */
abstract class RecipientHandlerSelectBase extends RecipientHandlerBase {

  /**
   * {@inheritdoc}
   */
  public function addToSpool() {
    $entity_type = $this->issue->getEntityTypeId();
    $query = $this->buildRecipientQuery();
    $query->addExpression("'$entity_type'", 'entity_type');
    $query->addExpression($this->issue->id(), 'entity_id');
    $query->addExpression(SpoolStorageInterface::STATUS_PENDING, 'status');
    $query->addExpression(\Drupal::time()->getRequestTime(), 'timestamp');
    $this->connection->insert('simplenews_mail_spool')->from($query)->execute();

    return $query->countQuery()->execute()->fetchField();
  }

  /**
   * {@inheritdoc}
   */
  protected function doCount() {
    return $this->buildRecipientQuery()->countQuery()->execute()->fetchField();
  }

  /**
   * Build the query that gets the list of recipients.
   *
   * @return \Drupal\Core\Database\Query\SelectInterface
   *   Query with the columns 'snid' and 'newsletter_id' for each recipient.
   */
  abstract protected function buildRecipientQuery();

}
