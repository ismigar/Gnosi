<?php

namespace Drupal\simplenews\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\simplenews\SubscriberHistoryInterface;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * Defines the simplenews subscriber history entity.
 *
 * @ContentEntityType(
 *   id = "simplenews_subscriber_history",
 *   label = @Translation("Simplenews subscriber history"),
 *   base_table = "simplenews_subscriber_history",
 *   entity_keys = {
 *     "id" = "id",
 *   },
 * )
 */
class SubscriberHistory extends ContentEntityBase implements SubscriberHistoryInterface {

  /**
   * {@inheritdoc}
   */
  public function getMail() {
    return $this->get('mail')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getTimestamp() {
    return $this->get('timestamp')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function getAuthor() {
    return $this->get('uid')->entity;
  }

  /**
   * {@inheritdoc}
   */
  public function getSource() {
    $source = $this->get('source')->value;
    [$type, $value] = explode(':', $source, 2);
    switch ($type) {
      case 'route':
        try {
          $route = \Drupal::service('router.route_provider')->getRouteByName($value);
          return $route->getDefault('_title');
        }
        catch (RouteNotFoundException $e) {
          return $this->t('Unknown route');
        }
    }
    return $source;
  }

  /**
   * {@inheritdoc}
   */
  public function isSubscribed(string $newsletter_id) {
    foreach ($this->get('subscriptions') as $item) {
      if ($item->target_id == $newsletter_id) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscribedNewsletterIds() {
    $ids = [];
    foreach ($this->get('subscriptions') as $delta => $item) {
      $ids[$delta] = $item->target_id;
    }
    return $ids;
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type) {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['mail'] = BaseFieldDefinition::create('email')
      ->setLabel(t('Email'))
      ->setRequired(TRUE);

    $fields['timestamp'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(t('Timestamp'))
      ->setRequired(TRUE);

    $fields['uid'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('Author'))
      ->setDescription(t('The user who made the change.'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'user');

    $fields['source'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Source'))
      ->setDescription(t('How the change was made.'))
      ->setRequired(TRUE);

    $fields['subscriptions'] = BaseFieldDefinition::create('entity_reference')
      ->setCardinality(FieldStorageDefinitionInterface::CARDINALITY_UNLIMITED)
      ->setLabel(t('Subscriptions'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'simplenews_newsletter');

    return $fields;
  }

}
