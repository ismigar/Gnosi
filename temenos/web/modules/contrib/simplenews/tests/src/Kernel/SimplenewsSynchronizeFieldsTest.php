<?php

namespace Drupal\Tests\simplenews\Kernel;

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\KernelTests\KernelTestBase;
use Drupal\language\Entity\ConfigurableLanguage;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\user\Entity\User;

/**
 * Tests that fields shared by user account and subscribers are synchronized.
 *
 * @group simplenews
 */
class SimplenewsSynchronizeFieldsTest extends KernelTestBase {
  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['simplenews', 'user', 'field', 'system', 'language'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('simplenews_subscriber');
    $this->installEntitySchema('simplenews_subscriber_history');
    $this->installSchema('system', ['sequences']);
    $this->config('system.mail')->set('interface.default', 'test_mail_collector')->save();
    $this->config('simplenews.settings')
      ->set('subscriber.sync_fields', TRUE)
      ->save();
    ConfigurableLanguage::create(['id' => 'fr'])->save();
  }

  /**
   * Tests that creating/updating User updates existing Subscriber base fields.
   */
  public function testSynchronizeBaseFields() {
    // Create subscriber.
    /** @var \Drupal\simplenews\Entity\Subscriber $subscriber */
    $subscriber = Subscriber::create([
      'mail' => 'user@example.com',
    ]);
    $subscriber->save();

    // Create user with same email.
    /** @var \Drupal\user\Entity\User $user */
    $user = User::create([
      'name' => 'user',
      'mail' => 'user@example.com',
      'preferred_langcode' => 'fr',
    ]);
    $user->save();

    // Assert that subscriber's fields are updated.
    $subscriber = Subscriber::load($subscriber->id());
    $this->assertEquals($user->id(), $subscriber->getUserId());
    $this->assertEquals('fr', $subscriber->getLangcode());
    $this->assertFalse($subscriber->isActive());

    // Update user fields.
    $user->setEmail('user2@example.com');
    $user->set('preferred_langcode', 'en');
    $user->activate();
    $user->save();

    // Assert that subscriber's fields are updated again.
    $subscriber = Subscriber::load($subscriber->id());
    $this->assertEquals('user2@example.com', $subscriber->getMail());
    $this->assertEquals('en', $subscriber->getLangcode());
    $this->assertTrue($subscriber->isActive());

    // Status is still synced even if sync_fields is not set.
    $this->config('simplenews.settings')->set('subscriber.sync_fields', FALSE)->save();
    $user->block();
    $user->save();
    $subscriber = Subscriber::load($subscriber->id());
    $this->assertFalse($subscriber->isActive());
  }

  /**
   * Tests that shared fields are synchronized.
   */
  public function testSynchronizeConfigurableFields() {
    // Create and attach a field to both.
    $this->addField('string', 'field_on_both', 'simplenews_subscriber');
    $this->addField('string', 'field_on_both', 'user');

    // Create a user and a subscriber.
    /** @var \Drupal\simplenews\Entity\Subscriber $subscriber */
    $subscriber = Subscriber::create([
      'field_on_both' => 'foo',
      'mail' => 'user@example.com',
      'created' => 2000,
    ]);
    $subscriber->save();
    /** @var \Drupal\user\Entity\User $user */
    $user = User::create([
      'name' => 'user',
      'field_on_both' => 'foo',
      'mail' => 'user@example.com',
      'created' => 1000,
    ]);
    $user->save();

    // Update the fields on the subscriber.
    $subscriber = Subscriber::load($subscriber->id());
    $subscriber->set('field_on_both', 'bar');
    $subscriber->set('created', 3000);
    $subscriber->save();

    // Assert that (only) the shared field is also updated on the user.
    $user = User::load($user->id());
    $this->assertEquals('bar', $user->get('field_on_both')->value);
    $this->assertEquals(1000, $user->get('created')->value);

    // Update the fields on the user.
    $user->set('field_on_both', 'baz');
    $user->set('created', 4000);
    $user->save();

    // Assert that (only) the shared field is also updated on the subscriber.
    $subscriber = Subscriber::load($subscriber->id());
    $this->assertEquals('baz', $subscriber->get('field_on_both')->value);
    $this->assertEquals(3000, $subscriber->get('created')->value);
  }

  /**
   * Tests that new entities copy values from corresponding user/subscriber.
   */
  public function testSetSharedFieldAutomatically() {
    // Create and attach a field to both.
    $this->addField('string', 'field_on_both', 'simplenews_subscriber');
    $this->addField('string', 'field_on_both', 'user');

    // Create a user with values for the fields.
    /** @var \Drupal\user\Entity\User $user */
    $user = User::create([
      'name' => 'user',
      'field_on_both' => 'foo',
      'mail' => 'user@example.com',
    ]);
    $user->save();

    // Create a subscriber.
    /** @var \Drupal\simplenews\Entity\Subscriber $subscriber */
    $subscriber = Subscriber::create([
      'mail' => 'user@example.com',
    ]);

    // Assert that the shared field already has a value.
    $this->assertEquals($user->get('field_on_both')->value, $subscriber->get('field_on_both')->value);

    // Create a subscriber with values for the fields.
    $subscriber = Subscriber::create([
      'field_on_both' => 'bar',
      'mail' => 'user@example.com',
    ]);
    $subscriber->save();

    // Create a user.
    $user = User::create([
      'name' => 'user',
      'mail' => 'user@example.com',
    ]);

    // Assert that the shared field already has a value.
    $this->assertEquals($user->get('field_on_both')->value, $subscriber->get('field_on_both')->value);
  }

  /**
   * Unsets the sync setting and asserts that fields are not synced.
   */
  public function testDisableSync() {
    // Disable sync.
    $this->config('simplenews.settings')->set('subscriber.sync_fields', FALSE)->save();

    // Create and attach a field to both.
    $this->addField('string', 'field_on_both', 'simplenews_subscriber');
    $this->addField('string', 'field_on_both', 'user');

    // Create a user with a value for the field.
    $user = User::create([
      'name' => 'user',
      'field_on_both' => 'foo',
      'mail' => 'user@example.com',
    ]);
    $user->save();

    // Create a subscriber.
    $subscriber = Subscriber::create([
      'mail' => 'user@example.com',
    ]);

    // Assert that the shared field does not get the value from the user.
    $this->assertNull($subscriber->get('field_on_both')->value);

    // Update the subscriber and assert that it is not synced to the user.
    $subscriber->set('field_on_both', 'bar');
    $subscriber->save();
    $user = User::load($user->id());
    $this->assertEquals('foo', $user->get('field_on_both')->value);

    // Create a subscriber with a value for the field.
    $subscriber = Subscriber::create([
      'field_on_both' => 'foo',
      'mail' => 'user2@example.com',
    ]);
    $subscriber->save();

    // Create a user.
    $user = User::create([
      'name' => 'user2',
      'mail' => 'user2@example.com',
    ]);

    // Assert that the shared field does not get the value from the subscriber.
    $this->assertNull($user->get('field_on_both')->value);

    // Update the user and assert that it is not synced to the subscriber.
    $user->set('field_on_both', 'bar');
    $user->save();
    $subscriber = Subscriber::load($subscriber->id());
    $this->assertEquals('foo', $subscriber->get('field_on_both')->value);
  }

  /**
   * Tests that recursion is prevented when a user is updated.
   *
   * If the synchronization between fields is active, whenever a user gets saved
   * the related subscriber gets its fields updated and viceversa.
   *
   * This test covers a bug that happened when a user gets saved. The checks
   * to prevent circular updates were not working correctly if the user entity
   * is the one being saved first.
   * The bug appeared when trying to use the AddRoleUser or RemoveRoleUser
   * actions on users with subscriptions.
   *
   * @see \Drupal\user\Plugin\Action\AddRoleUser
   * @see \Drupal\user\Plugin\Action\RemoveRoleUser
   */
  public function testUserRecursionPrevention() {
    // Create a subscriber.
    /** @var \Drupal\simplenews\Entity\Subscriber $subscriber */
    $subscriber = Subscriber::create([
      'mail' => 'user@example.com',
    ]);
    $subscriber->save();

    // Create a user with same email.
    /** @var \Drupal\user\Entity\User $user */
    $user = User::create([
      'name' => 'user',
      'mail' => 'user@example.com',
      'preferred_langcode' => 'fr',
    ]);
    $user->save();

    // Load the user, so that the static cache in the storage gets populated.
    $user = User::load($user->id());

    // Replicate the behaviour of two actions mentioned. The user entity gets
    // cloned and set in the original property. This will prevent a call to
    // ContentEntityStorageBase::loadUnchanged(), so the user entity available
    // in the static cache is the same object being used here.
    // @see \Drupal\user\Plugin\Action\AddRoleUser::execute()
    // @see \Drupal\user\Plugin\Action\RemoveRoleUser::execute()
    // @see \Drupal\Core\Entity\ContentEntityStorageBase::loadUnchanged()
    $user->original = clone $user;

    // Make a change to the user.
    $user->set('preferred_langcode', 'en');
    // Save the user. This will invoke simplenews_user_presave(), which will
    // sync the fields on the related subscriber entity and save it.
    // On post save of the subscriber entity, the user fields should be updated,
    // but not in this case since the updates are already coming from the user.
    // If this is not prevented, the user will be loaded (hitting the static
    // cache) and then saved again. Then, the user object, which is still the
    // same from the original request, will be modified during the
    // EntityStorageBase::doPostSave() method.
    // At this point the initial user presave will continue, but the entity
    // "original" property has been unset and a critical error will be thrown.
    // @see \Drupal\Core\Entity\EntityStorageBase::doPostSave()
    // @see \Drupal\Core\Entity\ContentEntityStorageBase::doPreSave()
    $user->save();

    // Assert that the field has been synced properly.
    $this->assertEquals($subscriber->getLangcode(), 'en');
  }

  /**
   * Creates and saves a field storage and instance.
   *
   * @param string $type
   *   The field type.
   * @param string $field_name
   *   The name of the new field.
   * @param string $entity_type
   *   The ID of the entity type to attach the field instance to.
   * @param string $bundle
   *   (optional) The entity bundle. Defaults to same as $entity_type.
   */
  protected function addField($type, $field_name, $entity_type, $bundle = NULL) {
    if (!isset($bundle)) {
      $bundle = $entity_type;
    }
    FieldStorageConfig::create([
      'field_name' => $field_name,
      'entity_type' => $entity_type,
      'type' => $type,
    ])->save();
    FieldConfig::create([
      'field_name' => $field_name,
      'entity_type' => $entity_type,
      'bundle' => $bundle,
    ])->save();
  }

}
