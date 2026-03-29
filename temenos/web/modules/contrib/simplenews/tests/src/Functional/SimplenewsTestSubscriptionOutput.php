<?php

namespace Drupal\Tests\simplenews\Functional;

/**
 * Test subscription output on user profile page.
 *
 * @group simplenews
 */
class SimplenewsTestSubscriptionOutput extends SimplenewsTestBase {

  /**
   * Test subscription output visibility for different users.
   */
  public function testSubscriptionVisiblity() {

    // Enable the extra field.
    \Drupal::service('entity_display.repository')->getViewDisplay('user', 'user')
      ->setComponent('simplenews', [
        'label' => 'hidden',
        'type' => 'simplenews',
      ])
      ->save();

    // Create admin user.
    $admin_user = $this->drupalCreateUser([
      'administer users',
    ]);
    // Create user that can view user profiles.
    $user = $this->drupalCreateUser([
      'access user profiles',
      'subscribe to newsletters',
      'access content',
    ]);
    $this->drupalLogin($admin_user);
    // Tests extra fields for admin user.
    $this->drupalGet('user/' . $admin_user->id());
    $this->assertSession()->linkExists('Manage subscriptions');
    $this->drupalLogout();
    // Tests extra fields for user.
    $this->drupalLogin($user);
    $this->drupalGet('user/' . $admin_user->id());
    $this->assertSession()->linkNotExists('Manage subscriptions');
    $this->drupalGet('user/' . $user->id());
    $this->assertSession()->linkExists('Manage subscriptions');
    $this->drupalLogout();
    // Tests extra fields for anonymous users.
    $this->drupalGet('user/' . $admin_user->id());
    $this->assertSession()->linkNotExists('Manage subscriptions');
    $this->drupalGet('user/' . $user->id());
    $this->assertSession()->linkNotExists('Manage subscriptions');
  }

}
