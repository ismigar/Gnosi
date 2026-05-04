<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Core\Url;
use Drupal\simplenews\SubscriberInterface;
use Drupal\views\Views;

/**
 * Tests a simplenews subscriber bulk form.
 *
 * @group simplenews
 */
class SimplenewsSubscriberBulkFormTest extends SimplenewsTestBase {

  /**
   * Permissions for the admin user that will be logged-in for test.
   *
   * @var array
   */
  protected static $permissions = [
    'administer simplenews subscriptions',
    'view simplenews subscriptions',
  ];

  /**
   * The test subscribers.
   *
   * @var \Drupal\simplenews\SubscriberInterface[]
   */
  protected $subscribers;

  /**
   * An admin test user account.
   *
   * @var \Drupal\Core\Session\AccountInterface
   */
  protected $adminUser;

  /**
   * The storage service.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $storage;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->storage = $this->container->get('entity_type.manager')->getStorage('simplenews_subscriber');

    $this->adminUser = $this->drupalCreateUser(static::$permissions);
    $this->drupalLogin($this->adminUser);

    for ($i = 0; $i < 3; $i++) {
      $subscriber = $this->storage->create([
        'mail' => $this->randomEmail(),
        'status' => SubscriberInterface::ACTIVE,
      ]);
      $subscriber->save();
      $this->subscribers[] = $subscriber;
    }
  }

  /**
   * Tests the subscriber bulk form.
   */
  public function testBulkDeleteAction(): void {
    $session = $this->getSession();
    $page = $session->getPage();
    $assert_session = $this->assertSession();

    // Check that all created items are present in the test view.
    $view = Views::getView('simplenews_subscribers');
    $view->execute();
    $this->assertSame((int) $view->total_rows, 3);

    // Check the operations are accessible to the logged in user.
    $this->drupalGet(Url::fromRoute('entity.simplenews_subscriber.collection'));
    // Current available actions: Delete.
    $available_actions = [
      'simplenews_subscriber_delete_action',
    ];
    foreach ($available_actions as $action_name) {
      $assert_session->optionExists('action', $action_name);
    }

    // Test deletion in bulk.
    $page->checkField('simplenews_subscriber_bulk_form[0]');
    $page->checkField('simplenews_subscriber_bulk_form[1]');
    $page->selectFieldOption('action', 'simplenews_subscriber_delete_action');
    $page->pressButton('Apply to selected items');
    $assert_session->pageTextContains('Are you sure you want to delete these simplenews subscriber entities?');
    $page->pressButton('Delete');
    $assert_session->pageTextContains('Deleted 2 items.');
    $this->assertNull($this->storage->loadUnchanged(1), 'Could not delete some of the simplenews subscriber entities.');
    $this->assertNull($this->storage->loadUnchanged(2), 'Could not delete some of the simplenews subscriber entities.');
  }

}
