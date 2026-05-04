<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\user\UserInterface;

/**
 * Un/subscription of anonymous and authenticated users.
 *
 * Subscription via block, subscription page and account page.
 *
 * @group simplenews
 */
class SimplenewsSubscribeTest extends SimplenewsTestBase {

  /**
   * Subscribe to multiple newsletters at the same time.
   */
  public function testSubscribeMultiple() {
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'administer permissions',
      'administer newsletters',
      'administer simplenews subscriptions',
    ]);
    $this->drupalLogin($admin_user);

    $this->drupalGet('admin/config/services/simplenews');
    for ($i = 0; $i < 5; $i++) {
      $this->clickLink(t('Add newsletter'));
      $name = $this->randomMachineName();
      $edit = [
        'name' => $name,
        'id' => strtolower($name),
        'description' => $this->randomString(20),
        'access' => 'default',
      ];
      $this->submitForm($edit, 'Save');
    }

    $newsletters = simplenews_newsletter_get_all();

    $this->drupalLogout();

    // Track hook results.
    $this->trackHookResults();

    $enable = array_rand($newsletters, 3);
    $mail = $this->randomEmail(8);
    $this->subscribe($enable, $mail);
    $this->assertSession()->pageTextContains('You will receive a confirmation e-mail shortly containing further instructions on how to complete your subscription.');
    $this->assertMailText(t('We have received a request to subscribe @user', ['@user' => $mail]));

    $mails = $this->getMails();
    $this->assertEquals('simpletest@example.com', $mails[0]['from']);
    $this->assertEquals('Drupal <simpletest@example.com>', $mails[0]['headers']['From']);

    $confirm_url = $this->extractConfirmationLink($this->getMail(0));

    $this->drupalGet($confirm_url);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');
    $this->assertNoHookResult();

    $this->submitForm([], 'Confirm');
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $mail . '</em>.');

    /** @var \Drupal\simplenews\Subscription\SubscriptionManagerInterface $subscription_manager */
    $subscription_manager = \Drupal::service('simplenews.subscription_manager');
    $subscriber_storage = \Drupal::entityTypeManager()->getStorage('simplenews_subscriber');
    $subscriber_storage->resetCache();

    // Verify subscription changes.
    foreach ($newsletters as $newsletter_id => $newsletter) {
      $is_subscribed = $subscription_manager->isSubscribed($mail, $newsletter_id);
      $subscription_newsletter = $subscriber_storage->getSubscriptionsByNewsletter($newsletter_id);

      if (in_array($newsletter_id, $enable)) {
        $this->assertTrue($is_subscribed);
        $this->assertCount(1, $subscription_newsletter);
        $this->assertHookResult('add', $mail, $newsletter_id);
      }
      else {
        $this->assertFalse($is_subscribed);
        $this->assertCount(0, $subscription_newsletter);
      }
    }
    $this->assertNoHookResult();

    // Go to the manage page and submit without changes.
    $subscriber = Subscriber::loadByMail($mail);
    $hash = simplenews_generate_hash($subscriber->getMail(), 'manage');
    $this->drupalGet('simplenews/manage/' . $subscriber->id() . '/' . \Drupal::time()->getRequestTime() . '/' . $hash);
    $this->submitForm([], 'Update');
    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');
    $this->assertCount(1, $this->getMails(), 'No confirmation mails have been sent.');
    $this->assertNoHookResult();

    // Unsubscribe from two of the three enabled newsletters.
    $disable = array_rand(array_flip($enable), 2);

    $edit = [
      'mail[0][value]' => $mail,
    ];
    foreach ($disable as $newsletter_id) {
      $edit['subscriptions[' . $newsletter_id . ']'] = FALSE;
    }
    $this->drupalGet('simplenews/manage/' . $subscriber->id() . '/' . \Drupal::time()->getRequestTime() . '/' . $hash);
    $this->submitForm($edit, 'Update');

    // Verify subscription changes.
    $subscriber_storage->resetCache();
    $still_enabled = array_diff($enable, $disable);
    foreach ($newsletters as $newsletter_id => $newsletter) {
      $is_subscribed = $subscription_manager->isSubscribed($mail, $newsletter_id);
      if (in_array($newsletter_id, $still_enabled)) {
        $this->assertTrue($is_subscribed);
      }
      else {
        $this->assertFalse($is_subscribed);
      }
    }

    foreach ($disable as $newsletter_id) {
      $this->assertHookResult('remove', $mail, $newsletter_id);
    }
    $this->assertNoHookResult();

    // Test expired confirmation links.
    $enable = array_rand($newsletters, 3);

    $mail = $this->randomEmail(8);
    foreach ($enable as $newsletter_id) {
      $edit['subscriptions[' . $newsletter_id . ']'] = TRUE;
    }
    $this->subscribe($enable, $mail);

    $subscriber = $this->getLatestSubscriber();
    $this->assertEquals($mail, $subscriber->getMail());
    $expired_timestamp = \Drupal::time()->getRequestTime() - 86401;
    $hash = simplenews_generate_hash($subscriber->getMail(), 'confirm', $expired_timestamp);
    $url = 'simplenews/confirm/' . $subscriber->id() . '/' . $expired_timestamp . '/' . $hash;
    $this->drupalGet($url);
    $this->assertSession()->pageTextContains('This link has expired.');
    $this->submitForm([], 'Request new confirmation mail');

    $confirm_url = $this->extractConfirmationLink($this->getMail());

    $this->assertMailText(t('We have received a request to subscribe @user', ['@user' => $mail]));
    $this->drupalGet($confirm_url);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');
    $this->submitForm([], 'Confirm');
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $mail . '</em>.');
  }

  /**
   * Test immediate confirmation.
   */
  public function testConfirmImmediate() {
    $this->trackHookResults();
    $email = $this->randomEmail(8);
    $this->subscribe('default', $email);
    $confirm_url = $this->extractConfirmationLink($this->getMail());
    $this->drupalGet("$confirm_url/ok");
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $email . '</em>.');
    $this->assertHookResult('add', $email, 'default');
    $this->assertNoHookResult();
  }

  /**
   * TestSubscribeAnonymous.
   *
   * Steps performed:
   *   0. Preparation
   *   1. Subscribe anonymous via block
   *   3. Subscribe anonymous via multi block.
   */
  public function testSubscribeAnonymous() {
    // 0. Preparation
    // Login admin
    // Set permission for anonymous to subscribe
    // Enable newsletter block
    // Logout admin.
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'administer newsletters',
      'administer permissions',
    ]
    );
    $this->drupalLogin($admin_user);

    // Create some newsletters for multi-sign up block.
    $this->drupalGet('admin/config/services/simplenews');
    for ($i = 0; $i < 5; $i++) {
      $this->clickLink(t('Add newsletter'));
      $name = $this->randomMachineName();
      $edit = [
        'name' => $name,
        'id' => strtolower($name),
        'description' => $this->randomString(20),
        'access' => 'default',
      ];
      $this->submitForm($edit, 'Save');
    }

    $newsletter_id = $this->getRandomNewsletter();

    $this->drupalLogout();

    // 1. Subscribe anonymous via block
    // Subscribe + submit
    // Assert confirmation message
    // Assert outgoing email
    //
    // Confirm using mail link
    // Confirm using mail link
    // Assert confirmation message
    // Setup subscription block with subscription form.
    $block_settings = [
      'default_newsletters' => [$newsletter_id],
      'message' => $this->randomMachineName(4),
    ];
    $single_block = $this->setupSubscriptionBlock($block_settings);

    // Testing invalid email error message.
    $mail = '@example.com';
    $edit = [
      'mail[0][value]' => $mail,
    ];
    $this->drupalGet('');
    $this->submitForm($edit, 'Subscribe');
    $this->assertSession()->pageTextContains('The email address ' . $mail . ' is not valid');

    // Now with valid email.
    $mail = $this->randomEmail(8);
    $edit = [
      'mail[0][value]' => $mail,
    ];
    $this->drupalGet('');
    $this->submitForm($edit, 'Subscribe');
    $this->assertSession()->pageTextContains('You will receive a confirmation e-mail shortly containing further instructions on how to complete your subscription.');

    $subscriber = $this->getLatestSubscriber();
    $this->assertNotFalse($subscriber, 'New subscriber entity successfully loaded.');
    $this->assertEquals($mail, $subscriber->getMail());
    $this->assertFalse($subscriber->isConfirmed());
    $confirm_url = $this->extractConfirmationLink($this->getMail(0));

    $this->drupalGet($confirm_url);
    $newsletter = Newsletter::load($newsletter_id);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');

    $this->submitForm([], 'Confirm');
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $mail . '</em>.');
    $this->assertSession()->addressEquals(new Url('<front>'));

    // Test that it is possible to register with a mail address that is already
    // a subscriber.
    $site_config = $this->config('user.settings');
    $site_config->set('register', 'visitors');
    $site_config->set('verify_mail', FALSE);
    $site_config->save();

    $pass = $this->randomMachineName();
    $edit = [
      'name' => $this->randomMachineName(),
      'mail' => $mail,
      'pass[pass1]' => $pass,
      'pass[pass2]' => $pass,
    ];
    $this->drupalGet('user/register');
    $this->submitForm($edit, 'Create new account');

    // Verify confirmation messages.
    $this->assertSession()->pageTextContains('Registration successful. You are now logged in.');

    // Verify that the subscriber has been updated and references to the correct
    // user.
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $subscriber = Subscriber::loadByMail($mail);
    $account = user_load_by_mail($mail);
    $this->assertEquals($subscriber->getUserId(), $account->id());
    $this->assertEquals($edit['name'], $account->getDisplayName());

    $this->drupalLogout();

    // Disable the newsletter block.
    $single_block->delete();

    // 3. Subscribe anonymous via multi block.
    // Try to submit multi-signup form without selecting a newsletter.
    $mail = $this->randomEmail(8);
    $this->subscribe([], $mail);
    $this->assertSession()->pageTextContains('Manage your newsletter subscriptions field is required.');

    // Now fill out the form and try again.
    $this->subscribe($newsletter_id, $mail);
    $this->assertSession()->pageTextContains('You will receive a confirmation e-mail shortly containing further instructions on how to complete your subscription.');

    $confirm_url = $this->extractConfirmationLink($this->getMail());

    $this->drupalGet($confirm_url);
    $newsletter = Newsletter::load($newsletter_id);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');

    $this->submitForm([], 'Confirm');
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $mail . '</em>.');

    // Try to subscribe again, this should not re-set the status to unconfirmed.
    $this->subscribe($newsletter_id, $mail);
    $this->assertSession()->pageTextContains('You will receive a confirmation e-mail shortly containing further instructions on how to complete your subscription.');

    $subscriber = Subscriber::loadByMail($mail);
    $this->assertNotFalse($subscriber, 'New subscriber entity successfully loaded.');
    $this->assertTrue($subscriber->isSubscribed($newsletter_id));

    // Visit the newsletter/subscriptions page with the hash.
    $subscriber = Subscriber::loadByMail($mail);

    $hash = simplenews_generate_hash($subscriber->getMail(), 'manage');
    $this->drupalGet('simplenews/manage/' . $subscriber->id() . '/' . \Drupal::time()->getRequestTime() . '/' . $hash);
    $this->assertSession()->pageTextContains('Subscriptions for ' . $mail);

    $edit = [
      'subscriptions[' . $newsletter_id . ']' => TRUE,
    ];
    $this->submitForm($edit, 'Update');

    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');

    // Make sure the subscription is confirmed.
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $subscriber = Subscriber::loadByMail($mail);

    $this->assertTrue($subscriber->isSubscribed($newsletter_id));

    // Attempt to fetch the page using a wrong hash but correct format.
    $hash = simplenews_generate_hash($subscriber->getMail() . 'a', 'manage');
    $this->drupalGet('simplenews/manage/' . $subscriber->id() . '/' . \Drupal::time()->getRequestTime() . '/' . $hash);
    $this->assertSession()->statusCodeEquals(404);

    // Test expired confirmation links.
    $mail = $this->randomEmail();
    $this->subscribe($newsletter_id, $mail);

    $subscriber = $this->getLatestSubscriber();
    $this->assertEquals($mail, $subscriber->getMail());
    $expired_timestamp = \Drupal::time()->getRequestTime() - 86401;
    $hash = simplenews_generate_hash($subscriber->getMail(), 'confirm', $expired_timestamp);
    $url = 'simplenews/confirm/' . $subscriber->id() . '/' . $expired_timestamp . '/' . $hash;
    $this->drupalGet($url);
    $this->assertSession()->pageTextContains('This link has expired.');
    $this->submitForm([], 'Request new confirmation mail');

    $confirm_url = $this->extractConfirmationLink($this->getMail());

    $this->drupalGet($confirm_url);
    $newsletter = Newsletter::load($newsletter_id);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');

    $this->submitForm([], 'Confirm');
    $this->assertSession()->responseContains('Subscription changes confirmed for <em class="placeholder">' . $mail . '</em>.');

    // Make sure the subscription is confirmed now.
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $subscriber = Subscriber::loadByMail($mail);

    $this->assertTrue($subscriber->isSubscribed($newsletter_id));
  }

  /**
   * Test anonymous subscription without verification.
   *
   * Steps performed:
   *   0. Preparation
   *   1. Subscribe anonymous via block.
   */
  public function testSubscribeAnonymousSingle() {
    // 0. Preparation
    // Set global skip_verification to TRUE
    // Login admin
    // Create single opt in newsletter.
    // Set permission for anonymous to subscribe
    // Enable newsletter block
    // Logout admin.
    $config = $this->config('simplenews.settings');
    $config->set('subscription.skip_verification', TRUE);
    $config->save();

    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'administer permissions',
      'administer newsletters',
    ]
    );
    $this->drupalLogin($admin_user);

    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink(t('Add newsletter'));
    $name = $this->randomMachineName();
    $edit = [
      'name' => $name,
      'id' => strtolower($name),
      'description' => $this->randomString(20),
      'access' => 'default',
    ];
    $this->submitForm($edit, 'Save');

    $this->drupalLogout();

    $newsletter_id = $edit['id'];

    // Setup subscription block with subscription form.
    $block_settings = [
      'default_newsletters' => [$newsletter_id],
      'message' => $this->randomMachineName(4),
    ];
    $this->setupSubscriptionBlock($block_settings);

    // 1. Subscribe anonymous via block
    // Subscribe + submit
    // Assert confirmation message
    // Verify subscription state.
    $mail = $this->randomEmail(8);
    $edit = [
      'mail[0][value]' => $mail,
    ];
    $this->drupalGet('');
    $this->submitForm($edit, 'Subscribe');
    $this->assertSession()->pageTextContains('You have been subscribed.');

    $subscriber = $this->getLatestSubscriber();
    $this->assertEquals($mail, $subscriber->getMail());
    $this->assertTrue($subscriber->isSubscribed($newsletter_id));
  }

  /**
   * Test anonymous subscription with redirect page after verification.
   *
   * Steps performed:
   * 0. Preparation
   * 1. Subscribe anonymous via block.
   * 2. Follow redirect link.
   */
  public function testSubscribeAnonymousRedirect() {
    // 0. Preparation
    // Login admin
    // Set permission for anonymous to subscribe
    // Enable newsletter block
    // Logout admin.
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'access administration pages',
      'administer newsletters',
      'administer permissions',
      'administer simplenews settings',
    ]
    );
    $this->drupalLogin($admin_user);

    // Create a newsletter.
    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink('Add newsletter');
    $name = $this->randomMachineName();
    $edit = [
      'name' => $name,
      'id' => strtolower($name),
      'description' => $this->randomString(20),
      'access' => 'default',
    ];
    $this->submitForm($edit, 'Save');

    $newsletter_id = $edit['id'];

    // Access and change the redirect path on configuration.
    $redirectPath = '/simplenews/validate';

    $this->drupalGet('admin/config/services/simplenews/settings/subscription');
    $this->assertSession()->statusCodeEquals(200);
    $this->submitForm(['simplenews_confirm_subscribe_page' => $redirectPath], 'Save configuration');
    $this->assertSession()->responseContains('The configuration options have been saved.');

    $this->drupalLogout();

    // Build the block.
    $block_settings = [
      'default_newsletters' => [$newsletter_id],
      'message' => $this->randomMachineName(4),
    ];
    $this->setupSubscriptionBlock($block_settings);

    // 1. Subscribe anonymous via block
    // Subscribe + submit
    // Assert confirmation message
    // Assert outgoing email
    // Confirm using mail link
    $mail = $this->randomEmail(8);
    $edit = [
      'mail[0][value]' => $mail,
    ];
    $this->drupalGet('');
    $this->submitForm($edit, 'Subscribe');
    $this->assertSession()->pageTextContains('You will receive a confirmation e-mail shortly containing further instructions on how to complete your subscription.');

    // Receive and access link on email.
    $subscriber = $this->getLatestSubscriber();
    $this->assertEquals($mail, $subscriber->getMail());
    $this->assertFalse($subscriber->isConfirmed());
    $confirm_url = $this->extractConfirmationLink($this->getMail(0));
    $this->drupalGet($confirm_url);

    Newsletter::load($newsletter_id);
    $this->assertSession()->responseContains('Are you sure you want to confirm your subscription for <em class="placeholder">' . simplenews_mask_mail($mail) . '</em>?');

    $this->submitForm([], 'Confirm');

    // 2. Follow redirect link.
    $this->assertSession()->addressEquals(Url::fromUri('internal:' . $redirectPath));

  }

  /**
   * TestSubscribeAuthenticated.
   *
   * Steps performed:
   *   0. Preparation
   *   1. Subscribe authenticated via block
   *   2. Unsubscribe authenticated via subscription page
   *   3. Subscribe authenticated via subscription page
   *   4. Unsubscribe authenticated via account page
   *   5. Subscribe authenticated via account page
   *   6. Subscribe authenticated via multi block.
   */
  public function testSubscribeAuthenticated() {
    // 0. Preparation
    // Login admin
    // Set permission for anonymous to subscribe
    // Enable newsletter block
    // Logout admin
    // Login Subscriber.
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'administer permissions',
      'administer newsletters',
    ]
    );
    $this->drupalLogin($admin_user);

    // Create some newsletters for multi-sign up block.
    $this->drupalGet('admin/config/services/simplenews');
    for ($i = 0; $i < 5; $i++) {
      $this->clickLink(t('Add newsletter'));
      $name = $this->randomMachineName();
      $edit = [
        'name' => $name,
        'id' => strtolower($name),
        'description' => $this->randomString(20),
        'access' => 'default',
      ];
      $this->submitForm($edit, 'Save');
    }

    $newsletter_id = $this->getRandomNewsletter();
    $this->drupalLogout();

    // Setup subscription block with subscription form.
    $block_settings = [
      'default_newsletters' => [$newsletter_id],
      'message' => $this->randomMachineName(4),
    ];
    $single_block = $this->setupSubscriptionBlock($block_settings);
    $subscriber_user = $this->drupalCreateUser(['subscribe to newsletters']);
    $this->drupalLogin($subscriber_user);
    $this->assertEquals(0, $this->countSubscribers());

    // 1. Subscribe authenticated via block
    // Subscribe + submit
    // Assert confirmation message.
    $this->submitForm([], 'Subscribe');
    $this->assertSession()->pageTextContains('You have been subscribed.');
    $this->assertEquals(1, $this->countSubscribers());

    // Disable the newsletter block.
    $single_block->delete();

    // 3. Subscribe authenticated via account page.
    // Subscribe + submit
    // Assert confirmation message.
    $this->resetSubscribers();
    $edit = [
      "subscriptions[$newsletter_id]" => '1',
    ];
    $url = 'user/' . $subscriber_user->id() . '/simplenews';
    $this->drupalGet($url);
    $this->submitForm($edit, 'Save');
    $this->assertSession()->responseContains('Your newsletter subscriptions have been updated.');
    $this->assertEquals(1, $this->countSubscribers());

    // 4. Unsubscribe authenticated via account page
    // Unsubscribe + submit
    // Assert confirmation message.
    $edit = [
      "subscriptions[$newsletter_id]" => FALSE,
    ];
    $this->drupalGet($url);
    $this->submitForm($edit, 'Save');
    $this->assertSession()->responseContains('Your newsletter subscriptions have been updated.');

    $subscriber = Subscriber::loadByMail($subscriber_user->getEmail());
    $this->assertTrue($subscriber->isUnsubscribed($newsletter_id), t('Subscriber is unsubscribed'));

    // 5. Subscribe authenticated via account page
    // Subscribe + submit
    // Assert confirmation message.
    $this->resetSubscribers();
    $edit = [
      "subscriptions[$newsletter_id]" => '1',
    ];
    $this->drupalGet($url);
    $this->submitForm($edit, 'Save');
    $this->assertSession()->responseContains('Your newsletter subscriptions have been updated.');
    $count = 1;
    $this->assertEquals($count, $this->countSubscribers());

    // Try to submit multi-signup form without selecting a newsletter.
    $subscriber_user2 = $this->drupalCreateUser(['subscribe to newsletters']);
    $this->drupalLogin($subscriber_user2);

    // Check that the user has only access to their own subscriptions page.
    $this->drupalGet('user/' . $subscriber_user->id() . '/simplenews');
    $this->assertSession()->statusCodeEquals(403);

    $this->drupalGet('user/' . $subscriber_user2->id() . '/simplenews');
    $this->assertSession()->statusCodeEquals(200);

    $this->assertSession()->fieldNotExists('mail[0][value]');
    $this->submitForm([], 'Save');
    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');

    // Nothing should have happened to subscriptions but this does create a
    // subscriber.
    $this->drupalGet('user/' . $subscriber_user2->id() . '/simplenews');
    $this->assertSession()->checkboxNotChecked('edit-subscriptions-' . $newsletter_id);
    $count++;
    $this->assertEquals($count, $this->countSubscribers());

    // Now fill out the form and try again.
    $edit = [
      'subscriptions[' . $newsletter_id . ']' => TRUE,
    ];
    $this->submitForm($edit, 'Save');
    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');
    $this->assertEquals($count, $this->countSubscribers());

    $this->drupalGet('user/' . $subscriber_user2->id() . '/simplenews');
    $this->assertSession()->checkboxChecked('edit-subscriptions-' . $newsletter_id);

    // Unsubscribe.
    $edit = [
      'subscriptions[' . $newsletter_id . ']' => FALSE,
    ];
    $this->submitForm($edit, 'Save');
    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');

    $this->drupalGet('user/' . $subscriber_user2->id() . '/simplenews');
    $this->assertSession()->checkboxNotChecked('edit-subscriptions-' . $newsletter_id);
  }

  /**
   * Tests Creation of Simplenews Subscription block.
   */
  public function testSimplenewsSubscriptionBlock() {
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
    ]);
    $this->drupalLogin($admin_user);
    $this->drupalGet('/admin/structure/block/add/simplenews_subscription_block/stark');
    // Check for Unique ID field.
    $this->assertSession()->pageTextContains('Unique ID');
    $edit = [
      'settings[unique_id]' => 'test_simplenews_123',
      'settings[newsletters][default]' => TRUE,
      'region' => 'header',
    ];
    $this->submitForm($edit, 'Save block');
    $this->drupalGet('');
    // Provided Unique ID is used as form_id.
    $this->assertSession()->elementExists('css', '#simplenews-subscriptions-block-test-simplenews-123');
  }

  /**
   * Tests admin creating a single subscriber.
   */
  public function testAdminCreate() {
    $admin_user = $this->drupalCreateUser(['administer simplenews subscriptions']);
    $this->drupalLogin($admin_user);

    $newsletter_id = $this->getRandomNewsletter();
    $mail = $this->randomEmail();
    $this->drupalGet('admin/people/simplenews/create');
    $this->assertSession()->pageTextContains('Add subscriber');
    $edit = [
      "subscriptions[$newsletter_id]" => TRUE,
      'mail[0][value]' => $mail,
    ];
    $this->submitForm($edit, 'Save');
    $this->assertSession()->pageTextContains('Subscriber ' . $mail . ' has been added.');

    $subscriber = Subscriber::loadByMail($mail);
    $this->assertTrue($subscriber->isSubscribed($newsletter_id));

    // Check that an unsubscribe link works without any permissions.
    $this->drupalLogout();
    user_role_revoke_permissions(AccountInterface::ANONYMOUS_ROLE, ['subscribe to newsletters']);

    $node = $this->drupalCreateNode([
      'type' => 'simplenews_issue',
      'simplenews_issue[target_id]' => ['target_id' => $newsletter_id],
    ]);
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
    \Drupal::service('simplenews.mailer')->sendSpool();

    $unsubscribe_url = $this->extractConfirmationLink($this->getMail(0), 'remove');
    $this->drupalGet($unsubscribe_url);
    $this->assertSession()->pageTextContains('Confirm remove subscription');
    $this->submitForm([], 'Unsubscribe');
    $this->assertSession()->pageTextContains('was unsubscribed from the Default newsletter mailing list.');
  }

  /**
   * Tests access to manage subscriptions with a hash.
   */
  public function testHashAuth() {
    // User subscriber can't use /newsletter/validate.
    $user = $this->drupalCreateUser(['subscribe to newsletters']);
    $mail = $user->getEmail();
    $subscriber = Subscriber::loadByMail($mail, 'create');
    $subscriber->save();
    $this->drupalGet('simplenews/subscriptions');
    $this->assertSession()->addressEquals('/simplenews/validate');

    $this->submitForm(['mail' => $mail], 'Submit');
    $this->assertSession()->pageTextContains("Please log in to manage your subscriptions.");
    $this->assertSession()->addressEquals('user/' . $user->id() . '/simplenews');

    // User subscriber can use a hash token.
    $hash = simplenews_generate_hash($subscriber->getMail(), 'manage');
    $this->drupalGet('simplenews/manage/' . $subscriber->id() . '/' . \Drupal::time()->getRequestTime() . '/' . $hash);
    $this->assertSession()->pageTextContains("Subscriptions for $mail");
    $this->submitForm([], 'Update');
    $this->assertSession()->pageTextContains('Your newsletter subscriptions have been updated.');

    // Anon subscriber can use /newsletter/validate.
    $this->config('simplenews.settings')
      ->set('subscription.skip_verification', TRUE)
      ->save();
    $mail2 = $this->randomEmail();
    $newsletter_id = $this->getRandomNewsletter();
    $this->subscribe($newsletter_id, $mail2);
    $subscriber2 = Subscriber::loadByMail($mail2);
    $this->drupalGet('/simplenews/validate');
    $this->submitForm(['mail' => $mail2], 'Submit');
    $this->assertSession()->pageTextContains("If $mail2 is subscribed, an email will be sent with a link to manage your subscriptions.");
    $validate_url = $this->extractConfirmationLink($this->getMail(0), 'manage');
    $this->drupalGet($validate_url);
    $this->assertSession()->pageTextContains("Subscriptions for $mail2");
  }

  /**
   * Tests formatting and escaping of subscription mails.
   */
  public function testFormatting() {
    $this->config('simplenews.settings')
      ->set('subscription.confirm_subject', 'Please <join> us & enjoy')
      ->set('subscription.confirm_body', "Hello & welcome,\n\nclick to join us <[simplenews-subscriber:confirm-url]>")
      ->save();

    $newsletter_id = $this->getRandomNewsletter();
    $newsletter = Newsletter::load($newsletter_id);
    $newsletter->name = 'Rise & <shine>';
    $newsletter->save();

    $mail = $this->randomEmail(8);
    $this->subscribe('default', $mail);

    $captured_emails = $this->container->get('state')->get('system.test_mail_collector') ?: [];
    $email = end($captured_emails);
    $this->assertEquals('Please <join> us & enjoy', $email['subject']);
    $this->assertStringContainsString("Hello & welcome,\n\nclick to join us  \n<http", $email['body']);
  }

  /**
   * Tests protection against duplicate subscribers.
   */
  public function testDuplicate() {
    foreach (['a', 'b', 'c', 'd', 'e'] as $i) {
      $edit = [
        'name' => "news_$i",
        'id' => $i,
        'access' => 'default',
      ];
      if ($i == 'e') {
        $edit['new_account'] = 'on';
      }

      Newsletter::create($edit)->save();
    }

    $this->config('simplenews.settings')
      ->set('subscription.skip_verification', TRUE)
      ->save();
    $this->config('user.settings')
      ->set('register', UserInterface::REGISTER_VISITORS)
      ->save();

    // - Create 2 anon subscribers with email A and B.
    // - Admin edits subscriber A to email B.
    // - Should fail.
    $mail_a = $this->randomEmail();
    $this->subscribe('a', $mail_a);
    $sub_a = $this->getLatestSubscriber();
    $this->assertEquals($mail_a, $sub_a->getMail());
    $mail_b = $this->randomEmail();
    $this->subscribe('b', $mail_b);
    $sub_b = $this->getLatestSubscriber();
    $this->assertEquals($mail_b, $sub_b->getMail());
    $this->assertEquals(2, $this->countSubscribers());

    $admin_user = $this->drupalCreateUser(['administer simplenews subscriptions', 'administer users']);
    $this->drupalLogin($admin_user);
    $this->drupalGet('admin/people/simplenews/edit/' . $sub_a->id());
    $this->submitForm(['mail[0][value]' => $mail_b], 'Save');
    $this->assertSession()->pageTextContains("A simplenews subscriber with email $mail_b already exists.");
    $this->assertEquals(2, $this->countSubscribers());

    // - Create a registered user C with no subscriptions.
    // - Admin changes email of subscriber A to C.
    // - Should link subscriptions of A to C.
    $user_c = $this->drupalCreateUser(['subscribe to newsletters']);
    $this->submitForm(['mail[0][value]' => $user_c->getEmail()], 'Save');
    $sub_c = Subscriber::loadByUid($user_c->id());
    $this->assertEquals($sub_a->id(), $sub_c->id());
    $this->assertEquals(['a'], $sub_c->getSubscribedNewsletterIds());
    $this->assertEquals(2, $this->countSubscribers());

    // - Create a registered user subscriber D.
    // - Admin changes email to B.
    // - Should delete subscriber B.
    // - User D subscriptions should not change.
    $user_d = $this->drupalCreateUser(['subscribe to newsletters']);
    $this->subscribe('d', NULL, [], $user_d->id());
    $this->assertEquals(3, $this->countSubscribers());

    $this->drupalGet('user/' . $user_d->id() . '/edit');
    $this->submitForm(['mail' => $mail_b], 'Save');
    $this->assertEquals(2, $this->countSubscribers());
    $sub_d = Subscriber::loadByUid($user_d->id());
    $this->assertEquals(['d'], $sub_d->getSubscribedNewsletterIds());

    // - Create anon subscriber with email E.
    // - Register user with email E and subscribe new account.
    // - Subscription for user should be unconfirmed.
    // - Log-in.
    // - Subscription for user should be confirmed and combined with the first.
    $sub_mgr = \Drupal::service('simplenews.subscription_manager');
    $this->drupalLogout();
    $mail_e = $this->randomEmail();
    $this->subscribe('d', $mail_e);
    $sub_e = Subscriber::loadByMail($mail_e);
    $this->assertTrue($sub_e->isConfirmed());
    $this->assertEquals(['d'], $sub_e->getSubscribedNewsletterIds());
    $this->assertEquals(3, $this->countSubscribers());
    $this->assertTrue($sub_mgr->isSubscribed($mail_e, 'd'));

    $this->config('simplenews.settings')
      ->set('subscription.skip_verification', FALSE)
      ->save();
    $this->drupalGet('user/register');
    $this->submitForm(['mail' => $mail_e, 'name' => 'e'], 'Create new account');
    $this->assertSession()->pageTextContains('You have been subscribed to news_e');
    $user_e = user_load_by_mail($mail_e);
    $sub_user_e = Subscriber::loadByUid($user_e->id(), FALSE, FALSE);
    $this->assertFalse($sub_user_e->isConfirmed());
    $this->assertFalse($sub_mgr->isSubscribed($mail_e, 'e'));
    $this->assertEquals(['e'], $sub_user_e->getSubscribedNewsletterIds());
    $this->assertEquals(4, $this->countSubscribers());

    $resetUrl = user_pass_reset_url($user_e);
    $this->drupalGet($resetUrl);
    $this->submitForm([], 'Log in');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $sub_user_e = Subscriber::loadByUid($user_e->id());
    $this->assertTrue($sub_user_e->isConfirmed());
    $this->assertEquals(3, $this->countSubscribers());
    $this->assertTrue($sub_mgr->isSubscribed($mail_e, 'd'));
    $this->assertTrue($sub_mgr->isSubscribed($mail_e, 'e'));
    $this->assertEquals(['d', 'e'], $sub_user_e->getSubscribedNewsletterIds());
  }

  /**
   * Tests subscription block settings.
   */
  public function testBlockSettings() {
    foreach (['a', 'b'] as $i) {
      $edit = [
        'name' => "news_$i",
        'id' => $i,
        'access' => 'default',
      ];
      Newsletter::create($edit)->save();
    }

    // Set up block with 2 newsletters available, no defaults.
    $block = $this->setupSubscriptionBlock(['newsletters' => ['a', 'b']]);
    $user = $this->drupalCreateUser(['subscribe to newsletters']);
    $this->drupalLogin($user);

    // Check both newsletters are available. Get an error if we don't pick any.
    $this->assertSession()->fieldExists('subscriptions[a]');
    $this->assertSession()->fieldExists('subscriptions[b]');
    $this->submitForm([], 'Subscribe');
    $this->assertSession()->pageTextContains("Manage your newsletter subscriptions field is required.");

    // Subscribe to 'a'. Check only 'b' is now available.
    $this->submitForm(['subscriptions[a]' => 'a'], 'Subscribe');
    $this->assertSession()->pageTextContains("You have been subscribed.");
    $this->assertSession()->fieldNotExists('subscriptions[a]');

    // Subscribe to 'b'. Check no newsletters are available.
    $this->submitForm(['subscriptions[b]' => 'b'], 'Subscribe');
    $this->assertSession()->pageTextContains("You have been subscribed.");
    $this->assertSession()->pageTextContains("You are already subscribed");
    $this->assertSession()->fieldNotExists('subscriptions[b]');

    // Click 'Manage existing' and unsubscribe.
    $this->clickLink('Manage existing');
    $this->assertSession()->addressEquals('user/' . $user->id() . '/simplenews');
    $this->submitForm(['subscriptions[a]' => '0', 'subscriptions[b]' => '0'], 'Save');

    // Default one newsletter on, check it is ticked.
    $block->getPlugin()->setConfigurationValue('default_newsletters', ['a']);
    $block->save();
    $this->drupalGet('');
    $this->assertSession()->checkboxChecked('subscriptions[a]');
    $this->assertSession()->checkboxNotChecked('subscriptions[b]');

    // Also make it hidden. Check can subscribe without picking any.
    // Remove the manage link and check it isn't shown.
    $block->getPlugin()->setConfigurationValue('newsletters', ['b']);
    $block->getPlugin()->setConfigurationValue('show_manage', FALSE);
    $block->save();
    $this->drupalGet('');
    $this->assertSession()->linkNotExistsExact('Manage existing');
    $this->assertSession()->fieldNotExists('subscriptions[a]');
    $this->submitForm([], 'Subscribe');
    $this->assertSession()->pageTextContains("You have been subscribed.");
    $this->assertTrue(\Drupal::service('simplenews.subscription_manager')->isSubscribed($user->getEmail(), 'a'));
  }

  /**
   * Gets the number of subscribers entities.
   */
  protected function countSubscribers() {
    return \Drupal::entityQuery('simplenews_subscriber')->accessCheck(FALSE)->count()->execute();
  }

  /**
   * Delete all subscriber entities ready for the next test.
   */
  protected function resetSubscribers() {
    $storage = \Drupal::entityTypeManager()->getStorage('simplenews_subscriber');
    $storage->delete($storage->loadMultiple());
  }

  /**
   * Enables tracking of (un)subscribe hooks.
   */
  protected function trackHookResults() {
    \Drupal::state()->set('simplenews.test_hook_results', []);
  }

  /**
   * Checks that an (un)subscribe hook has been called.
   *
   * @param string $op
   *   The operation: add or remove.
   * @param string $email
   *   The subscriber email address.
   * @param string $newsletter_id
   *   The newsletter ID for this specific subscribe action.
   */
  protected function assertHookResult(string $op, string $email, string $newsletter_id) {
    $results = \Drupal::state()->get('simplenews.test_hook_results');
    $key = array_search([$op, $email, $newsletter_id], $results);
    $this->assertNotFalse($key, "Hook $op called for $email on newsletter $newsletter_id");
    unset($results[$key]);
    \Drupal::state()->set('simplenews.test_hook_results', $results);
  }

  /**
   * Checks that there were no extra calls to (un)subscribe hooks.
   */
  protected function assertNoHookResult() {
    $this->assertEmpty(\Drupal::state()->get('simplenews.test_hook_results'));
  }

}
