<?php

namespace Drupal\simplenews\Plugin\Validation\Constraint;

use Drupal\simplenews\SubscriberInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates that a field is unique for the given entity type.
 */
class SubscriberUniqueValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate($items, Constraint $constraint) {
    if (!$item = $items->first()) {
      return;
    }
    /** @var \Drupal\simplenews\SubscriberInterface $subscriber */
    $subscriber = $items->getEntity();
    if (!$subscriber->isConfirmed()) {
      return;
    }

    $field_name = $items->getFieldDefinition()->getName();
    $query = \Drupal::entityQuery('simplenews_subscriber')
      ->accessCheck(TRUE)
      ->condition($field_name, $item->value)
      ->condition('status', SubscriberInterface::UNCONFIRMED, '<>')
      ->range(0, 1)
      ->count();

    // Using isset() instead of !empty() as 0 and '0' are valid ID values for
    // entity types using string IDs.
    $entity_id = $subscriber->id();
    if (isset($entity_id)) {
      $query->condition('id', $entity_id, '<>');
    }

    if ($query->execute()) {
      $this->context->addViolation($constraint->message, [
        '%value' => $item->value,
        '@entity_type' => $subscriber->getEntityType()->getSingularLabel(),
        '@field_name' => $items->getFieldDefinition()->getLabel(),
      ]);
    }
  }

}
