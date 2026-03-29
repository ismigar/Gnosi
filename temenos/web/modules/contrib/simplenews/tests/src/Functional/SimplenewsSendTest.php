<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Core\Messenger\MessengerInterface;
use Drupal\node\Entity\Node;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Spool\SpoolStorageInterface;
use Drupal\user\Entity\User;

/**
 * Test cases for creating and sending newsletters.
 *
 * @group simplenews
 */
class SimplenewsSendTest extends SimplenewsTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'send newsletter',
      'administer nodes',
      'administer simplenews subscriptions',
      'create simplenews_issue content',
      'edit any simplenews_issue content',
      'view own unpublished content',
      'delete any simplenews_issue content',
    ]);
    $this->drupalLogin($admin_user);

    // Subscribe a few users.
    $this->setUpSubscribers(5);
  }

  /**
   * Creates and sends a node using the API.
   */
  public function testProgrammaticNewsletter() {
    // Create a very basic node.
    $node = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'uid' => 0,
      'status' => 1,
    ]);
    $node->simplenews_issue->target_id = $this->getRandomNewsletter();
    $node->simplenews_issue->handler = 'simplenews_all';
    $node->save();

    // Send the node.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();
    \Drupal::service('simplenews.spool_storage')->clear();
    // Update sent status for newsletter admin panel.
    \Drupal::service('simplenews.mailer')->updateSendStatus();

    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $node->getTitle(), $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have been received a mail');

    // Create another node.
    $node = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'uid' => 0,
      'status' => 1,
    ]);
    $node->simplenews_issue->target_id = $this->getRandomNewsletter();
    $node->simplenews_issue->handler = 'simplenews_all';
    $node->save();

    // Send the node.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Make sure that they have been added.
    $this->assertEquals(5, \Drupal::service('simplenews.spool_storage')->countMails());

    // Mark them as 'in progress', fake a currently running send process.
    $this->assertCount(2, \Drupal::service('simplenews.spool_storage')->getMails(2));

    // Those two should be excluded if we get mails a second time.
    $this->assertCount(3, \Drupal::service('simplenews.spool_storage')->getMails());

    // The count should still include all the mails because they are still
    // in the spool.  This is needed for correct operation of code such as
    // Mailer::updateSendStatus().
    $this->assertEquals(5, \Drupal::service('simplenews.spool_storage')->countMails());
  }

  /**
   * Send a newsletter without cron.
   */
  public function testSendNowNoCron() {
    // Disable cron.
    $config = $this->config('simplenews.settings');
    $config->set('mail.use_cron', FALSE);
    $config->save();

    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Send');
    $this->assertSession()->pageTextContains('Test');
    $this->assertSession()->pageTextNotContains('Send newsletter when published');

    // Verify state.
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));

    // Send now.
    $this->submitForm([], 'Send now');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_READY, $node->simplenews_issue->status, t('Newsletter sending finished'));

    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $edit['title[0][value]'], $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have been received a mail');

    $this->assertEquals(5, $node->simplenews_issue->sent_count, 'subscriber count is correct');
  }

  /**
   * Send multiple newsletters without cron.
   */
  public function testSendMultipleNoCron() {
    // Disable cron.
    $config = $this->config('simplenews.settings');
    $config->set('mail.use_cron', FALSE);
    $config->save();

    // Verify that the newsletter settings are shown.
    $nodes = [];
    for ($i = 0; $i < 3; $i++) {
      $this->drupalGet('node/add/simplenews_issue');
      $this->assertSession()->pageTextContains('Create Newsletter Issue');

      $edit = [
        'title[0][value]' => $this->randomString(10),
        'simplenews_issue[target_id]' => 'default',
        // The last newsletter shouldn't be published.
        'status[value]' => $i != 2,
      ];
      $this->submitForm($edit, 'Save');
      $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
      $nodes[] = Node::load($matches[1]);

      // Verify state.
      $node = current($nodes);
      $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));
    }
  }

  /**
   * Send a newsletter using cron and a low throttle.
   */
  public function testSendNowCronThrottle() {
    $config = $this->config('simplenews.settings');
    $config->set('mail.throttle', 3);
    $config->save();

    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Send');
    $this->assertSession()->pageTextContains('Test');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));

    // Send now.
    $this->submitForm([], 'Send now');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_PENDING, $node->simplenews_issue->status, t('Newsletter sending pending.'));

    // Verify that no mails have been sent yet.
    $mails = $this->getMails();
    $this->assertCount(0, $mails, 'No mails were sent yet.');

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(5, $spooled, t('5 mails have been added to the mail spool'));

    // Run cron for the first time.
    simplenews_cron();

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_PENDING, $node->simplenews_issue->status, t('Newsletter sending pending.'));
    $this->assertEquals(3, $node->simplenews_issue->sent_count, 'subscriber count is correct');

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(2, $spooled, t('2 mails remaining in spool.'));

    // Run cron for the second time.
    simplenews_cron();

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_READY, $node->simplenews_issue->status, t('Newsletter sending finished.'));

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(0, $spooled, t('No mails remaining in spool.'));

    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $edit['title[0][value]'], $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have been received a mail');
    $this->assertEquals(5, $node->simplenews_issue->sent_count);
  }

  /**
   * Send a newsletter using cron.
   */
  public function testSendNowCron() {

    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
    ];
    // Try preview first.
    $this->submitForm($edit, 'Preview');

    $this->clickLink(t('Back to content editing'));

    // Then save.
    $this->submitForm([], 'Save');

    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Send');
    $this->assertSession()->pageTextContains('Test');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));

    // Send now.
    $this->submitForm([], 'Send now');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_PENDING, $node->simplenews_issue->status, t('Newsletter sending pending.'));

    // Verify that no mails have been sent yet.
    $mails = $this->getMails();
    $this->assertCount(0, $mails, t('No mails were sent yet.'));

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(5, $spooled, t('5 mails have been added to the mail spool'));

    // Check warning message on node edit form.
    $this->clickLink(t('Edit'));
    $this->assertSession()->pageTextContains('This newsletter issue is currently being sent. Any changes will be reflected in the e-mails which have not been sent yet.');

    // Run cron.
    simplenews_cron();

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_READY, $node->simplenews_issue->status, t('Newsletter sending finished.'));

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(0, $spooled, t('No mails remaining in spool.'));

    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $edit['title[0][value]'], $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have been received a mail');
  }

  /**
   * Send a newsletter on publish without using cron.
   */
  public function testSendPublishNoCron() {
    // Disable cron.
    $config = $this->config('simplenews.settings');
    $config->set('mail.use_cron', FALSE);
    $config->save();

    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
      'status[value]' => FALSE,
    ];
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Send');
    $this->assertSession()->pageTextContains('Test');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));

    // Send now.
    $this->submitForm([], 'Send on publish');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache([$node->id()]);
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_PUBLISH, $node->simplenews_issue->status, t('Newsletter set up for sending on publish.'));

    $this->clickLink(t('Edit'));
    $this->submitForm(['status[value]' => TRUE], 'Save');

    // Send on publish does not send immediately.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache([$node->id()]);
    \Drupal::service('simplenews.mailer')->attemptImmediateSend([], FALSE);

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache([$node->id()]);
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_READY, $node->simplenews_issue->status, t('Newsletter sending finished'));
    // @todo test sent subscriber count.
    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $edit['title[0][value]'], $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have been received a mail');
  }

  /**
   * Test newsletter update.
   *
   * @throws \Drupal\Component\Plugin\Exception\InvalidPluginDefinitionException
   * @throws \Drupal\Component\Plugin\Exception\PluginNotFoundException
   */
  public function testUpdateNewsletter() {
    // Create a second newsletter.
    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink(t('Add newsletter'));
    $edit = [
      'name' => $this->randomString(10),
      'id' => strtolower($this->randomMachineName(10)),
      'description' => $this->randomString(20),
    ];
    $this->submitForm($edit, 'Save');
    $this->assertSession()->pageTextContains('Newsletter ' . $edit['name'] . ' has been added');

    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    $first_newsletter_id = $this->getRandomNewsletter();

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => $first_newsletter_id,
    ];
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created.');

    // Verify newsletter.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($matches[1]);
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter sending not started.'));
    $this->assertEquals($first_newsletter_id, $node->simplenews_issue->target_id);

    do {
      $second_newsletter_id = $this->getRandomNewsletter();
    } while ($first_newsletter_id == $second_newsletter_id);

    $this->clickLink(t('Edit'));
    $update = [
      'simplenews_issue[target_id]' => $second_newsletter_id,
    ];
    $this->submitForm($update, 'Save');

    // Verify newsletter.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter sending not started.'));
    $this->assertEquals($second_newsletter_id, $node->simplenews_issue->target_id, t('Newsletter has newsletter_id @id.', ['@id' => $second_newsletter_id]));
  }

  /**
   * Tests failing to send mails from cron.
   */
  public function testSendFail() {
    // Create and send an issue.
    $issue = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'simplenews_issue' => ['target_id' => $this->getRandomNewsletter()],
    ]);
    $issue->save();

    \Drupal::service('simplenews.spool_storage')->addIssue($issue);

    // Force some mails to fail, then abort.
    \Drupal::messenger()->deleteAll();
    $results_alter = [
      SpoolStorageInterface::STATUS_PENDING,
      SpoolStorageInterface::STATUS_FAILED,
      -1,
    ];
    $this->container->get('state')->set('simplenews.test_result_alter', $results_alter);
    simplenews_cron();

    // Check there is no error message.
    $this->assertCount(0, \Drupal::messenger()->messagesByType(MessengerInterface::TYPE_ERROR), 'No error messages printed');

    // Check the status on the newsletter tab.  The pending mail should be
    // retried.
    $this->drupalGet('node/1/simplenews');
    $this->assertSession()->pageTextContains('Newsletter issue is pending, 0 mails sent out of 5, 1 errors.');

    // Allow one mail to succeed, and the pending mail should be treated as an
    // error. Also, check if "Newsletters can only be sent once" is shown.
    $results_alter = [
      SpoolStorageInterface::STATUS_DONE,
      SpoolStorageInterface::STATUS_PENDING,
      SpoolStorageInterface::STATUS_FAILED,
    ];
    $this->container->get('state')->set('simplenews.test_result_alter', $results_alter);
    simplenews_cron();
    $this->drupalGet('node/1/simplenews');
    $this->assertSession()->pageTextContains('Newsletter issue sent to 2 subscribers, 3 errors.');
    $this->assertSession()->pageTextContains('Newsletters can only be sent once.');

  }

  /**
   * Tests subscribed reason.
   */
  public function testReason() {
    $newsletter = $this->getRandomNewsletter();
    $reason = $this->randomString(50);
    $this->drupalGet("/admin/config/services/simplenews/manage/$newsletter");
    $this->submitForm(['reason' => $reason], 'Save');

    // Create issue.
    $issue = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'simplenews_issue' => ['target_id' => $newsletter],
    ]);
    $issue->save();

    // Send test.
    $to = $this->randomEmail(8);
    $this->drupalGet('node/1/simplenews');
    $this->submitForm(['test_address' => $to], 'Send test newsletter issue');
    $this->assertSession()->pageTextContains("Test newsletter sent to anonymous $to");
    $mails = $this->getMails();
    $mail = end($mails);
    $this->assertEquals('simplenews_test', $mail['id']);
    $this->assertEquals($to, $mail['to']);
    $this->assertStringContainsString($reason, $mail['body']);
    $this->assertStringContainsString('This is a test version of the newsletter.', $mail['body']);
    $this->assertStringNotContainsString('This email is a one-off message sent by an administrator.', $mail['body']);

    // Send for real.
    \Drupal::service('simplenews.spool_storage')->addIssue($issue);
    simplenews_cron();
    $mails = $this->getMails();
    $mail = end($mails);
    $this->assertEquals('simplenews_node', $mail['id']);
    $this->assertStringContainsString($reason, $mail['body']);
    $this->assertStringNotContainsString('This is a test version of the newsletter.', $mail['body']);
    $this->assertStringNotContainsString('This email is a one-off message sent by an administrator.', $mail['body']);

    // Send extra copy.
    $this->drupalGet('node/1/simplenews');
    $this->submitForm(['test_address' => $to], 'Send extra newsletter issue');
    $this->assertSession()->pageTextContains("Test newsletter sent to anonymous $to");
    $mails = $this->getMails();
    $mail = end($mails);
    $this->assertEquals('simplenews_extra', $mail['id']);
    $this->assertEquals($to, $mail['to']);
    $this->assertStringNotContainsString($reason, $mail['body']);
    $this->assertStringNotContainsString('This is a test version of the newsletter.', $mail['body']);
    $this->assertStringContainsString('This email is a one-off message sent by an administrator.', $mail['body']);
  }

  /**
   * Create a newsletter, send mails and then delete.
   */
  public function testDelete() {
    // Verify that the newsletter settings are shown.
    $this->drupalGet('node/add/simplenews_issue');
    $this->assertSession()->pageTextContains('Create Newsletter Issue');

    // Prevent deleting the mail spool entries automatically.
    $config = $this->config('simplenews.settings');
    $config->set('mail.spool_expire', 1);
    $config->save();

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    $this->clickLink(t('Newsletter'));
    $this->assertSession()->pageTextContains('Send');
    $this->assertSession()->pageTextContains('Test');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_NOT, $node->simplenews_issue->status, t('Newsletter not sent yet.'));

    // Send now.
    $this->submitForm([], 'Send now');

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_PENDING, $node->simplenews_issue->status, t('Newsletter sending pending.'));

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(5, $spooled, t('5 mails remaining in spool.'));

    // Verify that deleting isn't possible right now.
    $this->clickLink(t('Edit'));
    $this->assertSession()->pageTextNotContains('Delete');

    // Send mails.
    simplenews_cron();

    // Verify state.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $node = Node::load($node->id());
    $this->assertEquals(SIMPLENEWS_STATUS_SEND_READY, $node->simplenews_issue->status, t('Newsletter sending finished'));

    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(5, $spooled, t('Mails are kept in simplenews_mail_spool after being sent.'));

    // Verify mails.
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'All mails were sent.');
    foreach ($mails as $mail) {
      $this->assertEquals('[Default newsletter] ' . $edit['title[0][value]'], $mail['subject'], t('Mail has correct subject'));
      $this->assertArrayHasKey($mail['to'], $this->subscribers, t('Found valid recipient'));
      unset($this->subscribers[$mail['to']]);
    }
    $this->assertCount(0, $this->subscribers, 'all subscribers have received a mail');

    // Update timestamp to simulate pending lock expiration.
    \Drupal::database()->update('simplenews_mail_spool')
      ->fields([
        'timestamp' => \Drupal::time()->getRequestTime() - $this->config('simplenews.settings')->get('mail.spool_progress_expiration') - 1,
      ])
      ->execute();

    // Verify that kept mail spool rows are not re-sent.
    simplenews_cron();
    \Drupal::service('simplenews.spool_storage')->getMails();
    $mails = $this->getMails();
    $this->assertCount(5, $mails, 'No additional mails have been sent.');

    // Now delete.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $this->drupalGet($node->toUrl('edit-form'));
    $this->clickLink(t('Delete'));
    $this->submitForm([], 'Delete');

    // Verify.
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();
    $this->assertEmpty(Node::load($node->id()));
    $spooled = \Drupal::database()->query('SELECT COUNT(*) FROM {simplenews_mail_spool} WHERE entity_id = :nid AND entity_type = :type', [':nid' => $node->id(), ':type' => 'node'])->fetchField();
    $this->assertEquals(0, $spooled, t('No mails remaining in spool.'));
  }

  /**
   * Test that the correct user is used when sending newsletters.
   */
  public function testImpersonation() {

    // Create user to manage subscribers.
    $admin_user = $this->drupalCreateUser(['administer users']);
    $this->drupalLogin($admin_user);

    // Add users for some existing subscribers.
    $subscribers = array_slice($this->subscribers, -3);
    $users = [];
    foreach ($subscribers as $subscriber) {
      $user = User::create([
        'name' => $this->randomMachineName(),
        'mail' => $subscriber,
        'status' => 1,
      ]);
      $user->save();
      $users[$subscriber] = $user->id();
    }

    // Create a very basic node.
    $node = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'uid' => '0',
      'status' => 1,
      'body' => 'User ID: [current-user:uid]',
    ]);

    $node->simplenews_issue->target_id = $this->getRandomNewsletter();
    $node->simplenews_issue->handler = 'simplenews_all';
    $node->save();

    // Send the node.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();
    \Drupal::service('simplenews.spool_storage')->clear();
    // Update sent status for newsletter admin panel.
    \Drupal::service('simplenews.mailer')->updateSendStatus();

    // Verify mails.
    $mails = $this->getMails();
    // Check the mails sent to subscribers (who are also users) and verify each
    // users uid in the mail body.
    $mails_with_users = 0;
    $mails_without_users = 0;
    foreach ($mails as $mail) {
      $body = $mail['body'];
      $user_mail = $mail['to'];
      if (isset($users[$user_mail])) {
        if (strpos($body, 'User ID: ' . $users[$user_mail])) {
          $mails_with_users++;
        }
      }
      else {
        if (strpos($body, 'User ID: not yet assigned')) {
          $mails_without_users++;
        }
      }
    }
    $this->assertEquals(3, $mails_with_users, '3 mails with user ids found');
    $this->assertEquals(2, $mails_without_users, '2 mails with no user ids found');
  }

  /**
   * Test the theme suggestions when sending mails.
   */
  public function testNewsletterTheme() {
    // Install and enable the test theme.
    \Drupal::service('theme_installer')->install(['simplenews_newsletter_test_theme']);
    \Drupal::theme()->setActiveTheme(\Drupal::service('theme.initialization')->initTheme('simplenews_newsletter_test_theme'));

    $node = Node::create([
      'type' => 'simplenews_issue',
      'title' => $this->randomString(10),
      'uid' => '0',
      'status' => 1,
    ]);
    $node->simplenews_issue->target_id = $this->getRandomNewsletter();
    $node->simplenews_issue->handler = 'simplenews_all';
    $node->save();

    // Send the node.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();
    \Drupal::service('simplenews.spool_storage')->clear();
    // Update sent status for newsletter admin panel.
    \Drupal::service('simplenews.mailer')->updateSendStatus();

    $mails = $this->getMails();

    // Check if the correct theme was used in mails.
    $this->assertStringContainsString($node->getTitle(), $mails[0]['body']);
    $this->assertStringContainsString('Simplenews test theme', $mails[0]['body']);
    $this->assertEquals(1, preg_match('/ID: [0-9]/', $mails[0]['body']), 'Mail contains the subscriber ID');
  }

  /**
   * Test the correct handling of HTML special characters in plain text mails.
   */
  public function testHtmlEscaping() {
    $title = '><\'"-&&amp;--*';
    $name = 'Rise & shine';
    $node = Node::create([
      'type' => 'simplenews_issue',
      'title' => $title,
      'uid' => '0',
      'status' => 1,
    ]);
    $node->simplenews_issue->target_id = $this->getRandomNewsletter();
    $node->simplenews_issue->handler = 'simplenews_all';
    $node->save();

    $newsletter = Newsletter::load($node->simplenews_issue->target_id);
    $newsletter->name = $name;
    $newsletter->subject = '<[simplenews-newsletter:name]> [node:title]';
    $newsletter->save();

    // Send the node.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();
    \Drupal::service('simplenews.spool_storage')->clear();
    // Update sent status for newsletter admin panel.
    \Drupal::service('simplenews.mailer')->updateSendStatus();

    $mails = $this->getMails();

    // Check subject and body.
    // @todo Body is wrong due to
    // https://www.drupal.org/project/drupal/issues/3174760
    // $this->assertStringContainsString($title, $mails[0]['body']);
    $this->assertEquals("<$name> $title", $mails[0]['subject']);
  }

}
