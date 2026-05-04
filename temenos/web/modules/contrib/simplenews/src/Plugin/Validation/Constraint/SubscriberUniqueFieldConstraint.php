<?php

namespace Drupal\simplenews\Plugin\Validation\Constraint;

use Drupal\Core\Validation\Plugin\Validation\Constraint\UniqueFieldConstraint;

/**
 * Checks a subscriber field has a unique value among confirmed subscribers.
 *
 * @Constraint(
 *   id = "SubscriberUniqueField",
 *   label = @Translation("Subscriber unique field constraint", context = "Validation"),
 * )
 */
class SubscriberUniqueFieldConstraint extends UniqueFieldConstraint {

  /**
   * {@inheritdoc}
   */
  public function validatedBy(): string {
    return '\Drupal\simplenews\Plugin\Validation\Constraint\SubscriberUniqueValidator';
  }

}
