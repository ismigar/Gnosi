<?php

namespace Drupal\Tests\simplenews\Unit\Plugin\views\access;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Session\AccountInterface;
use Drupal\simplenews\Plugin\views\access\SubscribersList;
use Drupal\Tests\UnitTestCase;
use Symfony\Component\Routing\Route;

/**
 * Tests views simplenews_subscribers_list_access plugin.
 *
 * @group simplenews
 */
class SubscribersListTest extends UnitTestCase {

  /**
   * Test plugin works as expected.
   */
  public function testViewsSubscribersAccessPlugin() {
    $route = new Route('/test');
    $plugin = $this->createPartialMock(SubscribersList::class, ['init']);

    self::assertEquals(Cache::PERMANENT, $plugin->getCacheMaxAge());
    self::assertEquals(['user.permissions'], $plugin->getCacheContexts());
    self::assertEquals([], $plugin->getCacheTags());

    $plugin->alterRouteDefinition($route);
    self::assertEquals(
      'administer simplenews subscriptions+view simplenews subscriptions',
      $route->getRequirement('_permission'),
    );
  }

  /**
   * Test access method works as expected.
   *
   * @dataProvider accountPermissionsDataProvider
   */
  public function testAccess(array $account_permissions, bool $expected_result) {
    $plugin = $this->createPartialMock(SubscribersList::class, ['init']);

    $account = $this->createMock(AccountInterface::class);

    $permission_to_check = NULL;
    $account->expects($this->any())
      ->method('hasPermission')
      ->with($this->callback(function ($permission) use (&$permission_to_check) {
        $permission_to_check = $permission;
        return TRUE;
      }))
      ->willReturnCallback(function() use ($account_permissions, &$permission_to_check) {
        return in_array($permission_to_check, $account_permissions, TRUE);
      });

    self::assertEquals($expected_result, $plugin->access($account));
  }

  /**
   * Data provider for access method with possible cases.
   *
   * @return array
   *   A list of test case arguments.
   */
  public function accountPermissionsDataProvider() {
    return [
      [[], FALSE],
      [['administer simplenews subscriptions'], TRUE],
      [['view simplenews subscriptions'], TRUE],
      [
        [
          'administer simplenews subscriptions',
          'view simplenews subscriptions',
        ],
        TRUE,
      ],
    ];
  }
}
