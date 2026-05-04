<?php

namespace Drupal\Tests\simplenews\Functional;

/**
 * Test cases for creating and sending newsletters.
 *
 * @group simplenews
 */
class SimplenewsRecipientHandlerTest extends SimplenewsTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['simplenews_demo'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    // We install the demo module to get the recipient handlers. It creates
    // users and sends some mails so clear those first.
    $ids = \Drupal::entityQuery('user')->condition('uid', 0, '>')->accessCheck(FALSE)->execute();
    $storage = \Drupal::entityTypeManager()->getStorage('user');
    $entities = $storage->loadMultiple($ids);
    $storage->delete($entities);
    simplenews_cron();
    $this->container->get('state')->set('system.test_mail_collector', []);

    $admin_user = $this->drupalCreateUser([
      'send newsletter',
      'create simplenews_issue content',
      'edit any simplenews_issue content',
    ]);
    $this->drupalLogin($admin_user);
  }

  /**
   * Tests the "site mail" recipient handler.
   */
  public function testSiteMail() {
    // Verify that the recipient handler settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Recipients');
    $this->assertSession()->pageTextContains('How recipients should be selected.');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
      'simplenews_issue[handler]' => 'simplenews_site_mail',
    ];
    $this->submitForm($edit, 'Save');

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Newsletter issue will be sent to 1 subscribers.');
    $this->submitForm([], 'Send now');
    $this->checkRecipients(['simpletest@example.com' => 1]);
  }

  /**
   * Tests the "new users" recipient handler.
   */
  public function testNewUsers() {
    // Mark users 4&5 as logged in, so that the recipients are users 1-3.
    $users = $this->createUsers();
    foreach (array_slice($users, -2) as $user) {
      $user->setLastAccessTime(time())->save();
    }

    $this->drupalGet('node/add/simplenews_issue');
    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
      'simplenews_issue[handler]' => 'simplenews_new_users',
    ];
    $this->submitForm($edit, 'Save');

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Newsletter issue will be sent to 3 subscribers.');
    $this->submitForm([], 'Send now');
    $this->checkRecipients(array_slice($users, 0, 3));
  }

  /**
   * Tests the "subscribers by role" recipient handler.
   */
  public function testSubscribersByRole() {
    // Grant users 3&4 a role.
    $users = $this->createUsers('subscribe');
    $recipients = array_slice($users, 2, 2);
    $rid = $this->createRole([]);
    foreach ($recipients as $user) {
      $user->addRole($rid);
      $user->save();
    }

    $this->drupalGet('node/add/simplenews_issue');
    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
      'simplenews_issue[handler]' => 'simplenews_subscribers_by_role',
    ];
    $this->submitForm($edit, 'Save');

    // Edit and set the role.
    $this->clickLink(t('Edit'));
    $this->assertSession()->pageTextContains('Role');
    $edit = [
      'simplenews_issue[handler_settings][role]' => $rid,
    ];
    $this->submitForm($edit, 'Save');

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Newsletter issue will be sent to 2 subscribers.');
    $this->submitForm([], 'Send now');
    $this->checkRecipients($recipients);
  }

  /**
   * Create some test users.
   */
  protected function createUsers($subscribe = FALSE) {
    $subscription_manager = \Drupal::service('simplenews.subscription_manager');
    do {
      $new_user = $this->drupalCreateUser([]);
      if ($subscribe) {
        $subscription_manager->subscribe($new_user->getEmail(), 'default', FALSE);
      }
      $users[$new_user->getEmail()] = $new_user;
    } while (count($users) < 5);

    return $users;
  }

  /**
   * Checks the expected users received mails.
   */
  protected function checkRecipients(array $expected) {
    simplenews_cron();
    $mails = $this->getMails();
    $this->assertEquals(count($expected), count($mails), t('All mails were sent.'));
    foreach ($mails as $mail) {
      $this->assertArrayHasKey($mail['to'], $expected, t('Found valid recipient @recip', ['@recip' => $mail['to']]));
      unset($expected[$mail['to']]);
    }
  }

}
