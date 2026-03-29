<?php

namespace Drupal\simplenews\Plugin\migrate\source\d7;

use Drupal\migrate\Row;
use Drupal\migrate_drupal\Plugin\migrate\source\DrupalSqlBase;

/**
 * Migration source for Subscriber entries in D7.
 *
 * @MigrateSource(
 *   id = "simplenews_subscriber",
 *   source_module = "simplenews"
 * )
 */
class Subscriber extends DrupalSqlBase {

  /**
   * {@inheritdoc}
   */
  public function fields() {
    return [
      'snid' => $this->t('Subscriber ID'),
      'activated' => $this->t('Activated'),
      'mail' => $this->t("Subscriber's e-mail address"),
      'uid' => $this->t('Corresponding user'),
      'language' => $this->t('Language'),
      'changes' => $this->t('Pending unconfirmed subscription changes'),
      'created' => $this->t('Time of creation'),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getIds() {
    return ['snid' => ['type' => 'integer']];
  }

  /**
   * {@inheritdoc}
   */
  public function query() {
    return $this->select('simplenews_subscriber', 's')
      ->fields('s')
      ->orderBy('snid');
  }

  /**
   * {@inheritdoc}
   */
  public function prepareRow(Row $row) {
    $result = parent::prepareRow($row);

    $version = $this->getModuleSchemaVersion('simplenews');
    $newsletter_id_field = 'newsletter_id';
    if ($version >= 7000 & $version < 7200) {
      $newsletter_id_field = 'tid';
    }

    // Add associated data from the subscriptions table.
    $q = $this->select('simplenews_subscription', 'sub');
    $q->addField('sub', $newsletter_id_field, 'newsletter_id');
    $q->fields('sub', ['status', 'timestamp', 'source']);
    $q->condition('sub.snid', $row->getSourceProperty('snid'));
    $subscriptions = $q->execute()->fetchAllAssoc('newsletter_id');
    $row->setSourceProperty('subscriptions', $subscriptions);

    return $result;
  }

}
