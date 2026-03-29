<?php

namespace Drupal\simplenews\Plugin\views\access;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\views\Plugin\views\access\AccessPluginBase;
use Symfony\Component\Routing\Route;

/**
 * Access plugin that provides access to subscribers list.
 *
 * @ViewsAccess(
 *   id = "simplenews_subscribers_list_access",
 *   title = @Translation("Simplenews: subscribers list"),
 *   help = @Translation("Access will be granted to simplenews subscribers list")
 * )
 */
class SubscribersList extends AccessPluginBase implements CacheableDependencyInterface {

  /**
   * Allowed permissions.
   *
   * @var array
   */
  protected $permissions = [
    'administer simplenews subscriptions',
    'view simplenews subscriptions',
  ];

  /**
   * {@inheritdoc}
   */
  public function summaryTitle() {
    return $this->t('Access to simplenews subscribers list');
  }

  /**
   * {@inheritdoc}
   */
  public function access(AccountInterface $account) {
    $has_permission = FALSE;

    foreach ($this->permissions as $permission) {
      if ($has_permission = $account->hasPermission($permission)) {
        break;
      }
    }

    return $has_permission;
  }

  /**
   * {@inheritdoc}
   */
  public function alterRouteDefinition(Route $route) {
    $route->setRequirement('_permission', implode('+', $this->permissions));
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheMaxAge() {
    return Cache::PERMANENT;
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts() {
    return ['user.permissions'];
  }

  /**
   *
   * {@inheritdoc}
   */
  public function getCacheTags() {
    return [];
  }

}
