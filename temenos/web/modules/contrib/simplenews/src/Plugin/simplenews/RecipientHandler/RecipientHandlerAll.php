<?php

namespace Drupal\simplenews\Plugin\simplenews\RecipientHandler;

use Drupal\simplenews\SubscriberInterface;

/**
 * This handler sends a newsletter issue to all its subscribers.
 *
 * As newsletters may have 100k subscribers, this class must be fast so extend
 * from RecipientHandlerSelectBase.
 *
 * @RecipientHandler(
 *   id = "simplenews_all",
 *   title = @Translation("All newsletter subscribers")
 * )
 */
class RecipientHandlerAll extends RecipientHandlerSelectBase {

  /**
   * {@inheritdoc}
   */
  protected function buildRecipientQuery() {
    $select = \Drupal::database()->select('simplenews_subscriber', 's');
    $select->innerJoin('simplenews_subscriber__subscriptions', 't', 's.id = t.entity_id');
    $select->addField('s', 'id', 'snid');
    $select->addField('t', 'subscriptions_target_id', 'newsletter_id');
    $select->condition('t.subscriptions_target_id', $this->getNewsletterId());
    $select->condition('s.status', SubscriberInterface::ACTIVE);

    return $select;
  }

  /**
   * {@inheritdoc}
   */
  protected function cacheCount() {
    return TRUE;
  }

}
