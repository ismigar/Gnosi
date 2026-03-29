<?php

namespace Drupal\simplenews;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Defines the access control handler for the simplenews subscriber entity type.
 *
 * @see \Drupal\simplenews\Entity\Subscriber
 */
class SubscriberAccessControlHandler extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account) {
    // Administrators can view/update/delete all subscribers.
    if ($account->hasPermission('administer simplenews subscriptions')) {
      return AccessResult::allowed()->cachePerPermissions();
    }

    if (($operation != 'delete') && $entity->getUserId()) {
      // For a subscription that corresponds to a user, access to view/update
      // is allowed for that user if they have permission. Don't allow users to
      // delete the subscription entirely, as we need to keep a record of the
      // subscription history.
      return AccessResult::allowedIf($entity->getUserId() == $account->id())
        ->andIf(AccessResult::allowedIfHasPermission($account, 'subscribe to newsletters'))
        ->addCacheableDependency($entity);
    }

    // Allow access to view subscribers based on the related permission.
    if ($operation == 'view') {
      return AccessResult::allowedIfHasPermission($account, 'view simplenews subscriptions');
    }

    // No opinion.
    return AccessResult::neutral();
  }

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL) {
    $field = $field_definition->getName();

    // Protect access to viewing the mail field.
    if (($field == 'mail') && ($operation == 'view')) {
      // Allow based on permissions.
      if ($account->hasPermission('administer simplenews subscriptions') || $account->hasPermission('view simplenews subscriptions')) {
        return AccessResult::allowed()->cachePerPermissions();
      }

      // Users can view their own value.
      if ($account->isAuthenticated() && $items && ($entity = $items->getEntity()) && ($entity->getUserId() == $account->id())) {
        return AccessResult::allowed()->addCacheableDependency($entity);
      }

      // Otherwise don't give access.
      return AccessResult::neutral();
    }

    if ($operation == 'edit') {
      switch ($field) {
        case 'uid':
          // No edit access even for admins.
          return AccessResult::forbidden();

        case 'mail':
        case 'langcode':
        case 'status':
          // No edit access if 'uid' is set.
          if ($items && ($entity = $items->getEntity()) && $entity->getUserId()) {
            return AccessResult::forbidden();
          }
          break;
      }

      // Start a new switch to allow reuse of cases.
      switch ($field) {
        case 'created':
        case 'langcode':
        case 'status':
          // Only admin can edit.
          return AccessResult::allowedIfHasPermission($account, 'administer simplenews subscriptions');
      }
    }

    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

}
