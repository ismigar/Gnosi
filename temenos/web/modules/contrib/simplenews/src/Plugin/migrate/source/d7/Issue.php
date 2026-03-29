<?php

namespace Drupal\simplenews\Plugin\migrate\source\d7;

use Drupal\migrate_drupal\Plugin\migrate\source\DrupalSqlBase;

/**
 * Migration source for Subscriber issues in D7 (7.x-1.x branch).
 *
 * @MigrateSource(
 *   id = "simplenews_issue",
 *   source_module = "simplenews"
 * )
 */
class Issue extends DrupalSqlBase {

  /**
   * {@inheritdoc}
   */
  public function fields() {
    return [
      'nid' => $this->t('{node} that is used as newsletter.'),
      'tid' => $this->t('The newsletter category ID this newsletter belongs to.'),
      'status' => $this->t('Sent status of the newsletter issue (0 = not sent; 1 = pending; 2 = sent, 3 = send on publish).'),
      'sent_subscriber_count' => $this->t('The count of subscribers to the newsletter when it was sent.'),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getIds() {
    return ['nid' => ['type' => 'integer']];
  }

  /**
   * {@inheritdoc}
   */
  public function query() {
    return $this->select('simplenews_newsletter', 'sn')
      ->fields('sn')
      ->orderBy('nid');
  }

}
