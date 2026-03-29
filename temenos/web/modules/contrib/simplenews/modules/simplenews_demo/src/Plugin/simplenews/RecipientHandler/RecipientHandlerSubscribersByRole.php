<?php

namespace Drupal\simplenews_demo\Plugin\simplenews\RecipientHandler;

use Drupal\Component\Utility\Html;
use Drupal\simplenews\Plugin\simplenews\RecipientHandler\RecipientHandlerEntityBase;
use Drupal\simplenews\SubscriberInterface;
use Drupal\user\Entity\Role;
use Drupal\user\RoleInterface;

/**
 * This handler sends to all subscribers with the specified role.
 *
 * @RecipientHandler(
 *   id = "simplenews_subscribers_by_role",
 *   title = @Translation("Subscribers by role")
 * )
 */
class RecipientHandlerSubscribersByRole extends RecipientHandlerEntityBase {

  /**
   * {@inheritdoc}
   */
  public function settingsForm() {
    $roles = Role::loadMultiple();
    unset($roles[RoleInterface::ANONYMOUS_ID]);
    $roles = array_map(fn(RoleInterface $role) => Html::escape($role->label()), $roles);

    $element['role'] = [
      '#type' => 'select',
      '#title' => t('Role'),
      '#default_value' => $this->configuration['role'] ?? NULL,
      '#options' => $roles,
    ];

    return $element;
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery() {
    return \Drupal::entityQuery('simplenews_subscriber')
      ->condition('status', SubscriberInterface::ACTIVE)
      ->condition('subscriptions', $this->getNewsletterId())
      ->condition('uid.entity.roles', $this->configuration['role'])
      ->accessCheck(FALSE);
  }

}
