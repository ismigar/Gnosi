<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\block\Entity\Block;
use Drupal\Component\Utility\Html;
use Drupal\node\Entity\Node;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\SubscriberInterface;
use Drupal\views\Entity\View;

/**
 * Managing of newsletter categories and content types.
 *
 * @group simplenews
 */
class SimplenewsAdministrationTest extends SimplenewsTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['help'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->drupalPlaceBlock('help_block');
  }

  /**
   * Implement getNewsletterFieldId($newsletter_id)
   */
  protected function getNewsletterFieldId($newsletter_id) {
    return 'edit-subscriptions-' . str_replace('_', '-', $newsletter_id);
  }

  /**
   * Test various combinations of newsletter settings.
   */
  public function testNewsletterSettings() {

    // Allow registration of new accounts without approval.
    $site_config = $this->config('user.settings');
    $site_config->set('verify_mail', FALSE);
    $site_config->save();

    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'access help pages',
      'administer permissions',
      'administer newsletters',
      'administer simplenews subscriptions',
      'create simplenews_issue content',
      'send newsletter',
    ]);
    $this->drupalLogin($admin_user);

    $this->drupalGet('admin/config/services/simplenews');
    // Check if the help text is displayed.
    $this->assertSession()->pageTextContains('Newsletter allow you to send periodic e-mails to subscribers.');

    // Create a newsletter for all possible setting combinations.
    $new_account = ['none', 'off', 'on', 'silent'];
    $access = ['hidden', 'default'];

    foreach ($new_account as $new_account_setting) {
      foreach ($access as $access_setting) {
        $this->clickLink(t('Add newsletter'));
        $edit = [
          'name' => implode('-', [$new_account_setting, $access_setting]),
          'id' => implode('_', [$new_account_setting, $access_setting]),
          'description' => $this->randomString(20),
          'new_account' => $new_account_setting,
          'access' => $access_setting,
          'priority' => rand(0, 5),
          'receipt' => rand(0, 1) ? TRUE : FALSE,
          'from_name' => $this->randomMachineName(),
          'from_address' => $this->randomEmail(),
        ];
        $this->submitForm($edit, 'Save');
      }
    }

    // New title should be saved correctly.
    $this->drupalGet('admin/config/services/simplenews/manage/default');
    $this->submitForm(['subject' => 'Edited subject'], 'Save');
    $this->drupalGet('admin/config/services/simplenews/manage/default');
    $this->assertSession()->fieldValueEquals('subject', 'Edited subject');

    $newsletters = simplenews_newsletter_get_all();

    // Check registration form.
    $this->drupalLogout();
    $this->drupalGet('user/register');
    foreach ($newsletters as $newsletter) {
      if (strpos($newsletter->name, '-') === FALSE) {
        continue;
      }

      // Explicitly subscribe to the off-default newsletter.
      if ($newsletter->name == 'off-default') {
        $off_default_newsletter_id = $newsletter->id();
      }

      [$new_account_setting, $access_setting] = explode('-', $newsletter->name);
      if ($newsletter->new_account == 'on' && $newsletter->access != 'hidden') {
        $this->assertSession()->checkboxChecked($this->getNewsletterFieldId($newsletter->id()));
      }
      elseif ($newsletter->new_account == 'off' && $newsletter->access != 'hidden') {
        $this->assertSession()->checkboxNotChecked($this->getNewsletterFieldId($newsletter->id()));
      }
      else {
        $this->assertSession()->fieldNotExists('subscriptions[' . $newsletter->id() . ']');
      }
    }

    // Register a new user through the form.
    $pass = $this->randomMachineName();
    $edit = [
      'name' => $this->randomMachineName(),
      'mail' => $this->randomEmail(),
      'pass[pass1]' => $pass,
      'pass[pass2]' => $pass,
      'subscriptions[' . $off_default_newsletter_id . ']' => $off_default_newsletter_id,
    ];
    $this->submitForm($edit, 'Create new account');

    // Verify confirmation messages.
    $this->assertSession()->pageTextContains('Registration successful. You are now logged in.');
    foreach ($newsletters as $newsletter) {
      // Check confirmation message for all on and non-hidden newsletters and
      // the one that was explicitly selected.
      if (($newsletter->new_account == 'on' && $newsletter->access != 'hidden') || $newsletter->name == 'off-default') {
        $this->assertSession()->pageTextContains("You have been subscribed to $newsletter->name.");
      }
      else {
        // All other newsletters must not show a message, e.g. those which were
        // subscribed silently.
        $this->assertSession()->pageTextNotContains("You have been subscribed to $newsletter->name.");
      }
    }

    // Log out again.
    $this->drupalLogout();

    $user = user_load_by_name($edit['name']);
    // Set the password so that the login works.
    $user->passRaw = $edit['pass[pass1]'];

    // Verify subscriptions page, redirecting to newsletters tab.
    $this->drupalLogin($user);
    $this->drupalGet('simplenews/subscriptions');
    $this->assertSession()->addressEquals('user/' . $user->id() . '/simplenews');
    foreach ($newsletters as $newsletter) {
      if (strpos($newsletter->name, '-') === FALSE) {
        continue;
      }
      [$new_account_setting, $access_setting] = explode('-', $newsletter->name);
      if ($newsletter->access == 'hidden') {
        $this->assertSession()->fieldNotExists('subscriptions[' . $newsletter->id() . ']');
      }
      elseif ($newsletter->new_account == 'on' || $newsletter->name == 'off-default' || $newsletter->new_account == 'silent') {
        // All on, silent and the explicitly selected newsletter should be
        // checked.
        $this->assertSession()->checkboxChecked($this->getNewsletterFieldId($newsletter->id()));
      }
      else {
        $this->assertSession()->checkboxNotChecked($this->getNewsletterFieldId($newsletter->id()));
      }
    }

    // Unsubscribe from a newsletter.
    $edit = [
      'subscriptions[' . $off_default_newsletter_id . ']' => FALSE,
    ];
    $this->submitForm($edit, 'Save');
    $this->drupalGet('user/' . $user->id() . '/simplenews');
    $this->assertSession()->checkboxNotChecked($this->getNewsletterFieldId($off_default_newsletter_id));

    // Get a newsletter which has the block enabled.
    // @codingStandardsIgnoreStart
    /*foreach ($newsletters as $newsletter) {
      // The default newsletter is missing the from mail address. Use another one.
      if ($newsletter->block == TRUE && $newsletter->newsletter_id != 1 && $newsletter->access != 'hidden') {
        $edit_newsletter = $newsletter;
        break;
      }
    }*/
    // @codingStandardsIgnoreEnd

    // Check saving the subscriber as admin does not wipe the hidden newsletter
    // settings.
    $this->drupalLogin($admin_user);
    $subscriber = Subscriber::loadByMail($user->getEmail());
    $this->drupalGet('admin/people/simplenews/edit/' . $subscriber->id());
    $this->assertSession()->fieldNotExists($this->getNewsletterFieldId('on_hidden'));
    $this->assertSession()->fieldNotExists('mail');
    $this->drupalGet('admin/people/simplenews/edit/' . $subscriber->id());
    $this->submitForm([], 'Save');
    $this->drupalGet('admin/people/simplenews/edit/' . $subscriber->id());
    $this->assertTrue($subscriber->isSubscribed('on_hidden'));
    $this->assertTrue($subscriber->isUnsubscribed($off_default_newsletter_id));

    // @codingStandardsIgnoreStart
    /*$this->setupSubscriptionBlock($edit_newsletter->newsletter_id, $settings = array(
      'issue count' => 2,
      'previous issues' => 1,
    ));

    // Create a bunch of newsletters.
    $generated_names = array();
    $date = strtotime('monday this week');
    for ($index = 0; $index < 3; $index++) {
      $name = $this->randomMachineName();
      $generated_names[] = $name;
      $this->drupalGet('node/add/simplenews_issue');
      $edit = array(
        'title' => $name,
        'simplenews_newsletter[und]' => $edit_newsletter->newsletter_id,
        'date' => date('c', strtotime('+' . $index . ' day', $date)),
      );
      $this->submitForm($edit, 'Save');
      $this->clickLink(t('Newsletter'));
      $this->submitForm(['simplenews[send]' => SIMPLENEWS_COMMAND_SEND_NOW], 'Submit');
    }

    // Display the two recent issues.
    $this->drupalGet('');
    $this->assertText(t('Previous issues'), 'Should display recent issues.');

    $displayed_issues = $this->xpath("//div[@class='issues-list']/div/ul/li/a");

    $this->assertCount(2, $displayed_issues, 'Displays two recent issues.');

    $this->assertNotContains($generated_names[0], $displayed_issues);
    $this->assertContains($generated_names[1], $displayed_issues);
    $this->assertContains($generated_names[2], $displayed_issues);

    $this->drupalGet('admin/config/services/simplenews/manage/' . $edit_newsletter->id());
    $this->assertFieldByName('name', $edit_newsletter->name, t('Newsletter name is displayed when editing'));
    $this->assertFieldByName('description', $edit_newsletter->description, t('Newsletter description is displayed when editing'));

    $edit = array('block' => FALSE);
    $this->submitForm($edit, 'Save');

    \Drupal::entityTypeManager()->getStorage('simplenews_newsletter')->resetCache();
    $updated_newsletter = Newsletter::load($edit_newsletter->newsletter_id);
    $this->assertEquals(0, $updated_newsletter->block, t('Block for newsletter disabled'));

    $this->drupalGet('admin/structure/block');
    $this->assertNoText($edit_newsletter->name, t('Newsletter block was removed'));

    // Delete a newsletter.
    $this->drupalGet('admin/config/services/simplenews/manage/' . $edit_newsletter->id());
    $this->clickLink(t('Delete'));
    $this->submitForm([], 'Delete');

    // Verify that the newsletter has been deleted.
    \Drupal::entityTypeManager()->getStorage('simplenews_newsletter')->resetCache();
    $this->assertFalse(Newsletter::load($edit_newsletter->newsletter_id));
    $this->assertFalse(db_query('SELECT newsletter_id FROM {simplenews_newsletter} WHERE newsletter_id = :newsletter_id', array(':newsletter_id' => $edit_newsletter->newsletter_id))->fetchField());*/
    // @codingStandardsIgnoreEnd
    // Check if the help text is displayed.
    $this->drupalGet('admin/help/simplenews');
    $this->assertSession()->pageTextContains('Simplenews adds elements to the newsletter node add/edit');
    $this->drupalGet('admin/config/services/simplenews/add');
    $this->assertSession()->pageTextContains('You can create different newsletters (or subjects)');
  }

  /**
   * Test newsletter subscription management.
   *
   * Steps performed:
   */
  public function testSubscriptionManagement() {
    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'administer simplenews settings',
      'administer simplenews subscriptions',
      'administer users',
    ]);
    $this->drupalLogin($admin_user);

    // Create a newsletter.
    $newsletter_name = mb_strtolower($this->randomMachineName());
    $edit = [
      'name' => $newsletter_name,
      'id'  => $newsletter_name,
    ];
    $this->drupalGet('admin/config/services/simplenews/add');
    $this->submitForm($edit, 'Save');

    // This test adds a number of subscribers to each newsletter separately and
    // then adds another bunch to both. First step is to create some arrays
    // that describe the actions to take.
    $subscribers = [];

    $groups = [];
    $newsletters = simplenews_newsletter_get_all();
    foreach ($newsletters as $newsletter) {
      $groups[$newsletter->id()] = [$newsletter->id()];
    }
    $groups['all'] = array_keys($groups);

    $subscribers_flat = [];
    foreach ($groups as $key => $group) {
      for ($i = 0; $i < 5; $i++) {
        $mail = $this->randomEmail();
        $subscribers[$key][$mail] = $mail;
        $subscribers_flat[$mail] = $mail;
      }
    }

    // Create a user and assign one of the mail addresses of the all group.
    // The other subscribers will not be users, just anonymous subscribers.
    $user = $this->drupalCreateUser(['subscribe to newsletters']);
    // Make sure that user_save() does not update the user object, as it will
    // override the pass_raw property which we'll need to log this user in
    // later on.
    $user_mail = current($subscribers['all']);
    $user->setEmail($user_mail);
    $user->save();

    $delimiters = [',', ' ', "\n"];

    // Add the subscribers using mass subscribe.
    $this->drupalGet('admin/people');
    $this->clickLink('Subscribers');
    $i = 0;
    foreach ($groups as $key => $group) {
      $this->clickLink(t('Mass subscribe'));
      $edit = [
        // Implode with a different, supported delimiter for each group.
        'emails' => implode($delimiters[$i++], $subscribers[$key]),
      ];
      foreach ($group as $newsletter_id) {
        $edit['newsletters[' . $newsletter_id . ']'] = TRUE;
      }
      $this->submitForm($edit, 'Subscribe');
    }

    // Verify that all addresses are displayed in the table.
    $rows = $this->xpath('//tbody/tr');
    $mail_addresses = [];
    for ($i = 0; $i < count($subscribers_flat); $i++) {
      $email = trim($rows[$i]->find('xpath', '/td[2]')->getText());
      $mail_addresses[] = $email;
      if ($email == $user_mail) {
        // The user to which the mail was assigned should show the user name.
        $this->assertEquals($user->getAccountName(), trim($rows[$i]->find('xpath', '/td[3]/a')->getText()));
      }
      else {
        // Blank value for user name.
        $this->assertEquals(NULL, $rows[$i]->find('xpath', '/td[3]/a'));
      }
    }
    $this->assertCount(15, $mail_addresses);
    foreach ($mail_addresses as $mail_address) {
      $mail_address = (string) $mail_address;
      $this->assertArrayHasKey($mail_address, $subscribers_flat);
      unset($subscribers_flat[$mail_address]);
    }
    // All entries of the array should be removed by now.
    $this->assertEmpty($subscribers_flat);

    reset($groups);
    $first = 'default';

    $first_mail = array_rand($subscribers[$first]);
    $all_mail = array_rand($subscribers['all']);

    // Limit list to subscribers of the first newsletter only.
    // Build a flat list of the subscribers of this list.
    $subscribers_flat = array_merge($subscribers[$first], $subscribers['all']);

    $this->drupalGet('admin/people/simplenews', ['query' => ['subscriptions_target_id' => $first]]);

    // Verify that all addresses are displayed in the table.
    $rows = $this->xpath('//tbody/tr');
    $mail_addresses = [];
    for ($i = 0; $i < count($subscribers_flat); $i++) {
      $mail_addresses[] = trim($rows[$i]->find('xpath', '/td[2]')->getText());
    }
    $this->assertCount(10, $mail_addresses);
    foreach ($mail_addresses as $mail_address) {
      $mail_address = (string) $mail_address;
      $this->assertArrayHasKey($mail_address, $subscribers_flat);
      unset($subscribers_flat[$mail_address]);
    }
    // All entries of the array should be removed by now.
    $this->assertEmpty($subscribers_flat);

    // Filter a single mail address, the one assigned to a user.
    $edit = [
      'mail' => mb_substr(current($subscribers['all']), 0, 4),
    ];
    $this->drupalGet('admin/people/simplenews', ['query' => ['mail' => $edit['mail']]]);

    $rows = $this->xpath('//tbody/tr');
    $this->assertCount(1, $rows);
    $this->assertEquals(current($subscribers['all']), trim($rows[0]->find('xpath', '/td[2]')->getText()));
    // Mysteriously, the username is sometimes a span and sometimes a link.
    // Accept both.
    $this->assertEquals($user->label(), trim($rows[0]->find('xpath', '/td[3]/span|/td[3]/a')->getText()));

    // Reset the filter.
    $this->drupalGet('admin/people/simplenews');

    // Test mass-unsubscribe, unsubscribe one from the first group and one from
    // the all group, but only from the first newsletter.
    unset($subscribers[$first][$first_mail]);
    $edit = [
      'emails' => $first_mail . ', ' . $all_mail,
      'newsletters[' . $first . ']' => TRUE,
    ];
    $this->clickLink(t('Mass unsubscribe'));
    $this->submitForm($edit, 'Unsubscribe');

    // The all mail is still displayed because it's still subscribed to the
    // second newsletter. Reload the page to get rid of the confirmation
    // message.
    $this->drupalGet('admin/people/simplenews', ['query' => ['subscriptions_target_id' => $newsletter_name]]);
    $this->assertSession()->pageTextNotContains($first_mail);
    $this->assertSession()->pageTextContains($all_mail);

    // Limit to first newsletter, the all mail shouldn't be shown anymore.
    $this->drupalGet('admin/people/simplenews', ['query' => ['subscriptions_target_id' => $first]]);
    $this->assertSession()->pageTextNotContains($first_mail);
    $this->assertSession()->pageTextNotContains($all_mail);

    // Check exporting.
    $this->clickLink(t('Export'));
    $this->submitForm(['newsletters[' . $first . ']' => TRUE], 'Export');
    $exported_mails = $this->getSession()->getPage()->findField('emails')->getValue();
    foreach ($subscribers[$first] as $mail) {
      $this->assertStringContainsString($mail, $exported_mails, t('Mail address exported correctly.'));
    }
    foreach ($subscribers['all'] as $mail) {
      if ($mail != $all_mail) {
        $this->assertStringContainsString($mail, $exported_mails, t('Mail address exported correctly.'));
      }
      else {
        $this->assertStringNotContainsString($mail, $exported_mails, t('Unsubscribed mail address not exported.'));
      }
    }

    /** @var \Drupal\simplenews\Subscription\SubscriptionManagerInterface $subscription_manager */
    $subscription_manager = \Drupal::service('simplenews.subscription_manager');

    // Make sure there are unconfirmed subscriptions.
    $unconfirmed = [];
    $unconfirmed[] = $this->randomEmail();
    $unconfirmed[] = $this->randomEmail();
    foreach ($unconfirmed as $mail) {
      $subscription_manager->subscribe($mail, $first, FALSE);
      Subscriber::loadByMail($mail)->setStatus(SubscriberInterface::UNCONFIRMED)->save();
    }

    // Export unconfirmed users.
    $edit = [
      'states[active]' => FALSE,
      'states[inactive]' => FALSE,
      'states[unconfirmed]' => TRUE,
    ];
    $this->submitForm($edit, 'Export');

    $exported_mails = $this->getSession()->getPage()->findField('emails')->getValue();
    $exported_mails = explode(', ', $exported_mails);
    $this->assertCount(2, $exported_mails);
    $this->assertContains($unconfirmed[0], $exported_mails);
    $this->assertContains($unconfirmed[1], $exported_mails);

    // Make sure the user is subscribed to the first newsletter_id.
    $spool_storage = \Drupal::service('simplenews.spool_storage');
    $issue = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'simplenews_issue' => ['target_id' => $first],
    ]);

    $subscription_manager->subscribe($user_mail, $first, FALSE);
    $before_count = $spool_storage->issueCountRecipients($issue);

    // Block the user.
    $user->block();
    $user->save();

    $this->drupalGet('admin/people/simplenews');

    // Verify updated subscriptions count.
    drupal_static_reset('Drupal\simplenews\Plugin\simplenews\RecipientHandler\RecipientHandlerBase::count');
    $after_count = $spool_storage->issueCountRecipients($issue);
    $this->assertEquals($before_count - 1, $after_count, t('Blocked users are not counted in subscription count.'));

    // Test mass subscribe with previously unsubscribed users.
    for ($i = 0; $i < 3; $i++) {
      $tested_subscribers[] = $this->randomEmail();
    }
    $subscription_manager->subscribe($tested_subscribers[0], $first);
    $subscription_manager->subscribe($tested_subscribers[1], $first);
    $subscription_manager->unsubscribe($tested_subscribers[0], $first);
    $subscription_manager->unsubscribe($tested_subscribers[1], $first);
    $unsubscribed = implode(', ', array_slice($tested_subscribers, 0, 2));
    $edit = [
      'emails' => implode(', ', $tested_subscribers),
      'newsletters[' . $first . ']' => TRUE,
    ];

    $this->drupalGet('admin/people/simplenews/import');
    $this->submitForm($edit, 'Subscribe');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $this->assertFalse($subscription_manager->isSubscribed($tested_subscribers[0], $first), t('Subscriber not resubscribed through mass subscription.'));
    $this->assertFalse($subscription_manager->isSubscribed($tested_subscribers[1], $first), t('Subscriber not resubscribed through mass subscription.'));
    $this->assertTrue($subscription_manager->isSubscribed($tested_subscribers[2], $first), t('Subscriber subscribed through mass subscription.'));
    $substitutes = ['@name' => Newsletter::load($first)->label(), '@mail' => $unsubscribed];
    $this->assertSession()->pageTextContains('The following addresses were skipped because they have previously unsubscribed from ' . $substitutes['@name'] . ': ' . $substitutes['@mail'] . '.');
    $this->assertSession()->pageTextContains("If you would like to resubscribe them, use the 'Force resubscription' option.");

    // Try to mass subscribe without specifying newsletters.
    $tested_subscribers[2] = $this->randomEmail();
    $edit = [
      'emails' => implode(', ', $tested_subscribers),
      'resubscribe' => TRUE,
    ];

    $this->drupalGet('admin/people/simplenews/import');
    $this->submitForm($edit, 'Subscribe');
    $this->assertSession()->pageTextContains('Subscribe to field is required.');

    // Test mass subscribe with previously unsubscribed users and force
    // resubscription.
    $tested_subscribers[2] = $this->randomEmail();
    $edit = [
      'emails' => implode(', ', $tested_subscribers),
      'newsletters[' . $first . ']' => TRUE,
      'resubscribe' => TRUE,
    ];
    $this->drupalGet('admin/people/simplenews/import');
    $this->submitForm($edit, 'Subscribe');

    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $this->assertTrue($subscription_manager->isSubscribed($tested_subscribers[0], $first, t('Subscriber resubscribed trough mass subscription.')));
    $this->assertTrue($subscription_manager->isSubscribed($tested_subscribers[1], $first, t('Subscriber resubscribed trough mass subscription.')));
    $this->assertTrue($subscription_manager->isSubscribed($tested_subscribers[2], $first, t('Subscriber subscribed trough mass subscription.')));

    // Try to mass unsubscribe without specifying newsletters.
    $tested_subscribers[2] = $this->randomEmail();
    $edit = [
      'emails' => implode(', ', $tested_subscribers),
    ];

    $this->drupalGet('admin/people/simplenews/unsubscribe');
    $this->submitForm($edit, 'Unsubscribe');
    $this->assertSession()->pageTextContains('Unsubscribe from field is required.');

    // Create two blocks, to ensure that they are updated/deleted when a
    // newsletter is deleted.
    $only_first_block = $this->setupSubscriptionBlock(['newsletters' => [$first]]);
    $all_block = $this->setupSubscriptionBlock(['newsletters' => array_keys($groups)]);
    $enabled_newsletters = $all_block->get('settings')['newsletters'];
    $this->assertContains($first, $enabled_newsletters);

    // Delete newsletter.
    \Drupal::entityTypeManager()->getStorage('simplenews_newsletter')->resetCache();
    $this->drupalGet('admin/config/services/simplenews/manage/' . $first);
    $this->clickLink(t('Delete'));
    $this->submitForm([], 'Delete');

    $this->assertSession()->pageTextContains('All subscriptions to newsletter ' . $newsletters[$first]->name . ' have been deleted.');

    // Verify that all related data has been deleted/updated.
    $this->assertNull(Newsletter::load($first));
    $this->assertNull(Block::load($only_first_block->id()));

    $all_block = Block::load($all_block->id());
    $enabled_newsletters = $all_block->get('settings')['newsletters'];
    $this->assertNotContains($first, $enabled_newsletters);

    // Verify that all subscriptions of that newsletter have been removed.
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->pageTextNotContains($first);

    // Get a subscriber with a subscription.
    $this->drupalGet('admin/people/simplenews', ['query' => ['subscriptions_target_id' => $newsletter_name]]);
    $this->clickLink(t('Edit'), 1);

    // Get the subscriber id from the path.
    $this->assertEquals(1, preg_match('|admin/people/simplenews/edit/(\d+)\?destination|', $this->getUrl(), $matches), 'Subscriber found');
    $subscriber = Subscriber::load($matches[1]);

    $this->assertSession()->titleEquals('Edit subscriber ' . $subscriber->getMail() . ' | Drupal');
    $select = $this->assertSession()->selectExists('edit-status');
    $this->assertEquals('Active', $select->find('css', 'option[selected=selected]')->getText());

    // Disable account.
    $edit = [
      'status' => 0,
    ];
    $this->submitForm($edit, 'Save');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $this->assertFalse($subscription_manager->isSubscribed($subscriber->getMail(), $newsletter_name), t('Subscriber is not active'));

    // Re-enable account.
    $this->drupalGet('admin/people/simplenews/edit/' . $subscriber->id());
    $this->assertSession()->titleEquals('Edit subscriber ' . $subscriber->getMail() . ' | Drupal');
    $select = $this->assertSession()->selectExists('edit-status');
    $this->assertEquals('Inactive', $select->find('css', 'option[selected=selected]')->getText());
    $edit = [
      'status' => 1,
    ];
    $this->submitForm($edit, 'Save');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $this->assertTrue($subscription_manager->isSubscribed($subscriber->getMail(), $newsletter_name), t('Subscriber is active again.'));

    // Remove the subscription.
    $this->drupalGet('admin/people/simplenews/edit/' . $subscriber->id());
    $this->assertSession()->titleEquals('Edit subscriber ' . $subscriber->getMail() . ' | Drupal');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $edit['subscriptions[' . $newsletter_name . ']'] = FALSE;
    $this->submitForm($edit, 'Save');
    \Drupal::entityTypeManager()->getStorage('simplenews_subscriber')->resetCache();
    $this->assertFalse($subscription_manager->isSubscribed($subscriber->getMail(), $newsletter_name), t('Subscriber not subscribed anymore.'));

    /*
     * @todo Test Admin subscriber edit preferred $subscription->language
     */

    // Register a subscriber with an insecure e-mail address through the API
    // and make sure the address is correctly encoded.
    $xss_mail = "<script>alert('XSS');</script>";
    $subscription_manager->subscribe($xss_mail, $this->getRandomNewsletter(), FALSE);
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->responseNotContains($xss_mail);
    $this->assertSession()->responseContains(Html::escape($xss_mail));

    $xss_subscriber = Subscriber::loadByMail($xss_mail);
    $this->drupalGet('admin/people/simplenews/edit/' . $xss_subscriber->id());
    $this->assertSession()->responseNotContains($xss_mail);
    $this->assertSession()->responseContains(Html::escape($xss_mail));

    // Create a new user for the next test.
    $new_user = $this->drupalCreateUser(['subscribe to newsletters']);
    // Test for saving the subscription for no newsletter.
    $this->drupalGet('user/' . $new_user->id() . '/simplenews');
    $this->submitForm([], 'Save');
    $this->assertSession()->pageTextContains('The newsletter subscriptions for user ' . $new_user->getAccountName() . ' have been updated.');

    // Editing a subscriber with subscription.
    $edit = [
      'subscriptions[' . $newsletter_name . ']' => TRUE,
      'status' => 1,
      'mail[0][value]' => 'edit@example.com',
    ];
    $this->drupalGet('admin/people/simplenews/edit/' . $xss_subscriber->id());
    $this->submitForm($edit, 'Save');
    $this->assertSession()->pageTextContains('Subscriber edit@example.com has been updated.');

    // Create a second newsletter.
    $second_newsletter_name = mb_strtolower($this->randomMachineName());
    $edit2 = [
      'name' => $second_newsletter_name,
      'id'  => $second_newsletter_name,
    ];
    $this->drupalGet('admin/config/services/simplenews/add');
    $this->submitForm($edit2, 'Save');

    // Test for adding a subscriber.
    $subscribe = [
      'newsletters[' . $newsletter_name . ']' => TRUE,
      'emails' => 'drupaltest@example.com',
    ];
    $this->drupalGet('admin/people/simplenews/import');
    $this->submitForm($subscribe, 'Subscribe');

    // The subscriber should appear once in the list.
    $rows = $this->xpath('//tbody/tr');
    $counter = 0;
    foreach ($rows as $value) {
      if (trim($value->find('xpath', '/td[2]')->getText()) == 'drupaltest@example.com') {
        $counter++;
      }
    }
    $this->assertEquals(1, $counter);
    $this->assertSession()->pageTextContains('The following addresses were added or updated: drupaltest@example.com.');
    $this->assertSession()->pageTextContains("The addresses were subscribed to the following newsletters: $newsletter_name.");

    // Check subscription status.
    $subscriber = Subscriber::loadByMail('drupaltest@example.com');
    $this->assertTrue($subscriber->isSubscribed($newsletter_name));
    $this->assertFalse($subscriber->isSubscribed($second_newsletter_name));
  }

  /**
   * Test content type configuration.
   */
  public function testContentTypes() {
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'access administration pages',
      'administer permissions',
      'administer newsletters',
      'administer simplenews subscriptions',
      'bypass node access',
      'send newsletter',
    ]);
    $this->drupalLogin($admin_user);

    $this->drupalGet('admin/structure/types');
    $this->clickLink(t('Add content type'));
    $name = $this->randomMachineName();
    $type = strtolower($name);
    $edit = [
      'name' => $name,
      'type' => $type,
      'simplenews_content_type' => TRUE,
    ];
    $this->submitForm($edit, 'Save');

    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/' . $type);
    $this->assertSession()->pageTextContains('Issue');

    // Create an issue.
    $edit = [
      'title[0][value]' => $this->randomMachineName(),
      'body[0][value]' => 'User ID: [current-user:uid]',
      'simplenews_issue[target_id]' => $this->getRandomNewsletter(),
    ];
    $this->submitForm($edit, 'Save');

    $node = $this->drupalGetNodeByTitle($edit['title[0][value]']);

    $edit = [
      'title[0][value]' => $this->randomMachineName(),
      'body[0][value]' => 'Sample body text - Newsletter issue',
      'simplenews_issue[target_id]' => $this->getRandomNewsletter(),
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');

    // Assert that body text is displayed.
    $this->assertSession()->pageTextContains('Sample body text - Newsletter issue');

    $node2 = $this->drupalGetNodeByTitle($edit['title[0][value]']);

    // Assert subscriber count.
    $this->clickLink('Newsletter');
    $this->assertSession()->pageTextContains('Newsletter issue will be sent to 0 subscribers.');

    // Create some subscribers and subscribe to the default newsletter.
    for ($i = 0; $i < 3; $i++) {
      $subscriber = Subscriber::create(['mail' => $this->randomEmail()]);
      $subscriber->subscribe('default')->save();
      $subscribers[] = $subscriber;
    }

    // Check if the subscribers are listed in the newsletter tab.
    $this->drupalGet('node/1/simplenews');
    $this->assertSession()->pageTextContains('Newsletter issue will be sent to 3 subscribers.');

    // Send mails.
    $this->assertSession()->fieldExists('test_address');
    // Test newsletter to empty address and check the error message.
    $this->submitForm(['test_address' => ''], 'Send test newsletter issue');
    $this->assertSession()->pageTextContains('Missing email address.');
    // Test newsletter to invalid address and check the error message.
    $this->submitForm(['test_address' => 'invalid_address'], 'Send test newsletter issue');
    $this->assertSession()->pageTextContains('Invalid email address "invalid_address"');
    $this->submitForm(['test_address' => $admin_user->getEmail()], 'Send test newsletter issue');
    $this->assertSession()->pageTextContains('Test newsletter sent to user ' . $admin_user->getAccountName() . ' <' . $admin_user->getEmail() . '>');

    $mails = $this->getMails();
    $this->assertEquals('simplenews_test', $mails[0]['id']);
    $this->assertEquals($admin_user->getEmail(), $mails[0]['to']);
    $this->assertEquals(t('[Default newsletter] @title', ['@title' => $node->getTitle()]), $mails[0]['subject']);
    $this->assertStringContainsString('User ID: ' . $admin_user->id(), $mails[0]['body']);
    $this->assertStringNotContainsString('Unsubscribe from this newsletter', $mails[0]['body']);
    $this->assertStringNotContainsString('[simplenews-subscriber:unsubscribe-link]', $mails[0]['body']);

    // Update the content type, remove the simpletest checkbox.
    $edit = [
      'simplenews_content_type' => FALSE,
    ];
    $this->drupalGet('admin/structure/types/manage/' . $type);
    $this->submitForm($edit, 'Save');

    // Verify that the newsletter settings are still shown.
    // Note: Previously the field got autoremoved. We leave it remaining due to
    // potential data loss.
    $this->drupalGet('node/add/' . $type);
    $this->assertSession()->pageTextNotContains('Replacement patterns');
    $this->assertSession()->pageTextContains('Issue');

    // Test the visibility of subscription user component.
    $this->drupalGet('node/' . $node->id());
    $this->assertSession()->pageTextNotContains('Subscribed to');

    // Delete created nodes.
    $node->delete();
    $node2->delete();

    // @todo Test node update/delete.
    // Delete content type.
    // @todo Add assertions.
    $this->drupalGet('admin/structure/types/manage/' . $type . '/delete');
    $this->submitForm([], 'Delete');

    // Check the Add Newsletter Issue button.
    $this->drupalGet('admin/content/simplenews');
    $this->clickLink(t('Add Newsletter Issue'));
    $this->assertSession()->addressEquals('node/add/simplenews_issue');
    // Check if the help text is displayed.
    $this->assertSession()->pageTextContains('Add this newsletter issue to a newsletter by selecting a newsletter from the select list.');
  }

  /**
   * Test content subscription status filter in subscriber view.
   */
  public function testSubscriberStatusFilter() {
    // Make sure subscription overview can't be accessed without permission.
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->statusCodeEquals(403);

    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'create simplenews_issue content',
      'administer nodes',
      'administer simplenews subscriptions',
    ]);
    $this->drupalLogin($admin_user);

    // Create some subscribers and subscribe to the default newsletter.
    for ($i = 0; $i < 3; $i++) {
      $subscriber = Subscriber::create(['mail' => $this->randomEmail()]);
      $subscriber->subscribe('default')->save();
      $subscribers[] = $subscriber;
    }

    $subscribers[1]->setStatus(SubscriberInterface::UNCONFIRMED)->save();
    $subscribers[2]->unsubscribe('default')->save();

    $newsletters = simplenews_newsletter_get_all();

    // Filter out subscribers by their subscription status and assert the
    // output.
    $this->drupalGet('admin/people/simplenews', ['query' => ['status' => SubscriberInterface::ACTIVE, 'subscriptions_target_id' => 'default']]);
    $row = $this->xpath('//tbody/tr');
    $this->assertCount(1, $row);
    $this->assertEquals($subscribers[0]->getMail(), trim($row[0]->find('xpath', '/td[2]')->getText()));
    $this->drupalGet('admin/people/simplenews', ['query' => ['status' => SubscriberInterface::UNCONFIRMED, 'subscriptions_target_id' => 'default']]);
    $row = $this->xpath('//tbody/tr');
    $this->assertCount(1, $row);
    $this->assertEquals($subscribers[1]->getMail(), trim($row[0]->find('xpath', '/td[2]')->getText()));
    $this->assertEquals('Unconfirmed', trim($row[0]->find('xpath', '/td[5]')->getText()));
    $this->assertSession()->pageTextContains($newsletters['default']->name);
  }

  /**
   * Test newsletter issue overview.
   */
  public function testNewsletterIssuesOverview() {
    // Verify newsletter overview isn't available without permission.
    $this->drupalGet('admin/content/simplenews');
    $this->assertSession()->statusCodeEquals(403);

    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'create simplenews_issue content',
      'administer simplenews subscriptions',
      'administer nodes',
      'bypass node access',
      'send newsletter',
    ]);
    $this->drupalLogin($admin_user);

    // Create a newsletter.
    $name = $this->randomMachineName();
    $edit = [
      'name' => $name,
      'id'  => mb_strtolower($name),
    ];
    $this->drupalGet('admin/config/services/simplenews/add');
    $this->submitForm($edit, 'Save');

    // Create a newsletter issue and publish.
    $edit = [
      'title[0][value]' => 'Test_issue_1',
      'simplenews_issue[target_id]' => mb_strtolower($name),
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');

    // Create another newsletter issue and keep unpublished.
    $edit = [
      'title[0][value]' => 'Test_issue_2',
      'simplenews_issue[target_id]' => mb_strtolower($name),
      'status[value]' => FALSE,
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');

    // Test mass subscribe with previously unsubscribed users.
    for ($i = 0; $i < 3; $i++) {
      $subscribers[] = $this->randomEmail();
    }
    $edit = [
      'emails' => implode(', ', $subscribers),
      'newsletters[' . mb_strtolower($name) . ']' => TRUE,
    ];
    $this->drupalGet('admin/people/simplenews/import');
    $this->submitForm($edit, 'Subscribe');

    $this->drupalGet('admin/content/simplenews');
    // Check the correct values are present in the view.
    $rows = $this->xpath('//tbody/tr');
    // Check the number of results in the view.
    $this->assertCount(2, $rows);

    foreach ($rows as $row) {
      if ($row->find('xpath', '/td[2]/a')->getText() == 'Test_issue_2') {
        $this->assertEquals($name, trim($row->find('xpath', '/td[3]/a')->getText()));
        $this->assertEquals('Newsletter issue will be sent to 3 subscribers.', trim($row->find('xpath', '/td[6]/span')->getAttribute('title')));
        $this->assertEquals('✖', trim($row->find('xpath', '/td[4]')->getText()));
        $this->assertEquals('0/3', trim($row->find('xpath', '/td[6]/span')->getText()));
      }
      else {
        $this->assertEquals('✔', trim($row->find('xpath', '/td[4]')->getText()));
      }
    }
    // Send newsletter issues using bulk operations.
    $edit = [
      'node_bulk_form[0]' => TRUE,
      'node_bulk_form[1]' => TRUE,
      'action' => 'simplenews_send_action',
    ];
    $this->submitForm($edit, 'Apply to selected items');
    // Check the relevant messages.
    $this->assertSession()->pageTextContains('Newsletter issue Test_issue_2 will be sent when published.');
    $this->assertSession()->pageTextContains('Newsletter issue Test_issue_1 pending.');
    $rows = $this->xpath('//tbody/tr');
    // Assert the status message of each newsletter.
    foreach ($rows as $row) {
      if ($row->find('xpath', '/td[2]/a')->getText() == 'Test_issue_2') {
        $this->assertEquals('Newsletter issue will be sent to 3 subscribers on publish.', trim($row->find('xpath', '/td[6]/span')->getAttribute('title')));
      }
      else {
        $this->assertEquals('Newsletter issue is pending, 0 mails sent out of 3, 0 errors.', trim($row->find('xpath', '/td[6]/img')->getAttribute('title')));
        $this->assertEquals(\Drupal::service('file_url_generator')->generateString(\Drupal::service('extension.list.module')->getPath('simplenews') . '/images/sn-cron.png'), trim($row->find('xpath', '/td[6]/img')->getAttribute('src')));
      }
    }
    // Stop sending the pending newsletters.
    $edit = [
      'node_bulk_form[0]' => TRUE,
      'node_bulk_form[1]' => TRUE,
      'action' => 'simplenews_stop_action',
    ];
    $this->submitForm($edit, 'Apply to selected items');
    // Check the stop message.
    $this->assertSession()->pageTextContains('Sending of Test_issue_1 was stopped. 3 pending email(s) were deleted.');
    $rows = $this->xpath('//tbody/tr');
    // Check the send status of each issue.
    foreach ($rows as $row) {
      $this->assertEquals('Newsletter issue will be sent to 3 subscribers.', trim($row->find('xpath', '/td[6]/span')->getAttribute('title')));
    }

    // Send newsletter issues using bulk operations.
    $edit = [
      'node_bulk_form[0]' => TRUE,
      'node_bulk_form[1]' => TRUE,
      'action' => 'simplenews_send_action',
    ];
    $this->submitForm($edit, 'Apply to selected items');
    // Run cron to send the mails.
    $this->cronRun();
    $this->drupalGet('admin/content/simplenews');
    $rows = $this->xpath('//tbody/tr');
    // Check the send status of each issue.
    foreach ($rows as $row) {
      if ($row->find('xpath', '/td[2]/a')->getText() == 'Test_issue_2') {
        $this->assertEquals('Newsletter issue will be sent to 3 subscribers on publish.', trim($row->find('xpath', '/td[6]/span')->getAttribute('title')));
      }
      else {
        $this->assertEquals('Newsletter issue sent to 3 subscribers, 0 errors.', trim($row->find('xpath', '/td[6]/img')->getAttribute('title')));
        $this->assertEquals(\Drupal::service('file_url_generator')->generateString(\Drupal::service('extension.list.module')->getPath('simplenews') . '/images/sn-sent.png'), trim($row->find('xpath', '/td[6]/img')->getAttribute('src')));
      }
    }
  }

  /**
   * Test access for subscriber admin page.
   */
  public function testAccess() {
    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'administer simplenews subscriptions',
    ]);
    $this->drupalLogin($admin_user);

    // Create a newsletter.
    $newsletter_name = mb_strtolower($this->randomMachineName());
    $edit = [
      'name' => $newsletter_name,
      'id'  => $newsletter_name,
    ];
    $this->drupalGet('admin/config/services/simplenews/add');
    $this->submitForm($edit, 'Save');

    // Create a user and subscribe them.
    $user = $this->drupalCreateUser();
    $subscriber = Subscriber::create(['mail' => $user->getEmail()]);
    $subscriber->subscribe('default');
    $subscriber->setStatus(SubscriberInterface::ACTIVE)->save();

    // Check anonymous user can't access admin page.
    $this->drupalLogout();
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->statusCodeEquals(403);

    // Turn off the access permission on the view.
    $view = View::load('simplenews_subscribers');
    $display = &$view->getDisplay('default');
    $display['display_options']['access'] = ['type' => 'none', 'options' => []];
    $view->save();
    \Drupal::service('router.builder')->rebuild();

    // Check username is public but email is not shown.
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->pageTextContains($user->getAccountName());
    $this->assertSession()->pageTextNotContains($user->getEmail());

    // Grant view permission.
    $view_user = $this->drupalCreateUser([
      'view simplenews subscriptions',
    ]);
    $this->drupalLogin($view_user);

    // Check can see username and email.
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->pageTextContains($user->getAccountName());
    $this->assertSession()->pageTextContains($user->getEmail());
  }

}
