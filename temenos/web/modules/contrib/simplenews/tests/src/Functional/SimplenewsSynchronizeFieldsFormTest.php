<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Core\Url;
use Drupal\simplenews\Entity\Subscriber;

/**
 * Tests that shared fields are synchronized when using forms.
 *
 * @group simplenews
 */
class SimplenewsSynchronizeFieldsFormTest extends SimplenewsTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['field', 'simplenews'];

  /**
   * User.
   *
   * @var \Drupal\user\UserInterface
   */
  protected $user;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    // Add a field to both entities.
    $this->addField('string', 'field_shared', 'user');
    $this->addField('string', 'field_shared', 'simplenews_subscriber');

    // Create a user.
    $this->user = $this->drupalCreateUser([
      'administer simplenews subscriptions',
      'administer simplenews settings',
    ]);
    $this->user->setEmail('user@example.com');
    $this->user->set('field_shared', $this->randomMachineName());
    $this->user->save();
  }

  /**
   * Tests that fields are synchronized using the Subscriber form.
   */
  public function testSubscriberFormFieldSync() {
    // Create a subscriber for the user.
    $subscriber = Subscriber::create([
      'mail' => 'user@example.com',
    ]);
    $subscriber->save();
    $this->assertEquals($this->user->id(), $subscriber->getUserId());

    $subscriber_edit_url = Url::fromRoute(
      'entity.simplenews_subscriber.edit_form',
      ['simplenews_subscriber' => $subscriber->id()],
    );

    // Edit subscriber field and assert user field is changed accordingly.
    $this->drupalLogin($this->user);
    $this->drupalGet($subscriber_edit_url);
    $field = $this->assertSession()->fieldExists('field_shared[0][value]');
    $this->assertEquals($this->user->field_shared->value, $field->getValue());

    $new_value = $this->randomMachineName();
    $this->submitForm(['field_shared[0][value]' => $new_value], 'Save');
    $this->drupalGet($subscriber_edit_url);
    $field = $this->assertSession()->fieldExists('field_shared[0][value]');
    $this->assertEquals($new_value, $field->getValue());

    $user_edit_url = Url::fromRoute('entity.user.edit_form', ['user' => $this->user->id()]);
    $this->drupalGet($user_edit_url);
    $field = $this->assertSession()->fieldExists('field_shared[0][value]');
    $this->assertEquals($new_value, $field->getValue());

    // Unset the sync setting and assert field is not synced.
    $this->drupalGet(Url::fromRoute('simplenews.settings_subscriber'));
    $this->submitForm(['simplenews_sync_fields' => FALSE], 'Save configuration');

    $unsynced_value = $this->randomMachineName();
    $this->drupalGet($subscriber_edit_url);
    $this->submitForm(['field_shared[0][value]' => $unsynced_value], 'Save');
    $this->drupalGet($subscriber_edit_url);
    $field = $this->assertSession()->fieldExists('field_shared[0][value]');
    $this->assertEquals($unsynced_value, $field->getValue());

    $this->drupalGet($user_edit_url);
    $field = $this->assertSession()->fieldExists('field_shared[0][value]');
    $this->assertEquals($new_value, $field->getValue());
    $this->assertNotEquals($unsynced_value, $field->getValue());
  }

}
