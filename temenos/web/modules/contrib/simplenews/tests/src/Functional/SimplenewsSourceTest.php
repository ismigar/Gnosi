<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Component\Utility\Html;
use Drupal\node\Entity\Node;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\Mail\TestMail;
use Drupal\simplenews\Spool\SpoolStorageInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Header\MailboxHeader;
use Symfony\Component\Yaml\Yaml;

/**
 * Test cases for creating and sending newsletters.
 *
 * @group simplenews
 */
class SimplenewsSourceTest extends SimplenewsTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    // Create the filtered_html text format.
    $filtered_html_format = \Drupal::entityTypeManager()->getStorage('filter_format')->create([
      'format' => 'filtered_html',
      'name' => 'Filtered HTML',
      'weight' => 0,
      'filters' => [
        // URL filter.
        'filter_url' => [
          'weight' => 0,
          'status' => 1,
        ],
        // HTML filter.
        'filter_html' => [
          'weight' => 1,
          'status' => 1,
          'allowed-values' => '',
        ],
        // Line break filter.
        'filter_autop' => [
          'weight' => 2,
          'status' => 1,
        ],
        // HTML corrector filter.
        'filter_htmlcorrector' => [
          'weight' => 10,
          'status' => 1,
        ],
      ],
    ]);
    $filtered_html_format->save();

    $admin_user = $this->drupalCreateUser([
      'administer newsletters',
      'send newsletter',
      'administer nodes',
      'administer simplenews subscriptions',
      'create simplenews_issue content',
      'edit any simplenews_issue content',
      'view own unpublished content',
      'delete any simplenews_issue content',
      'administer simplenews settings',
      $filtered_html_format->getPermissionName(),
    ]);
    $this->drupalLogin($admin_user);
  }

  /**
   * Tests that sending a minimal implementation of the source interface works.
   */
  public function testSendMinimalSourceImplementation() {

    // Create a basic plaintext test source and send it.
    $plain_mail = new TestMail('plain');
    \Drupal::service('simplenews.mailer')->sendMail($plain_mail);
    $mails = $this->getMails();
    $mail = $mails[0];

    // Assert resulting mail.
    $this->assertEquals('simplenews_node', $mail['id']);
    $this->assertEquals('simplenews', $mail['module']);
    $this->assertEquals('node', $mail['key']);
    $this->assertEquals($plain_mail->getRecipient(), $mail['to']);
    $this->assertEquals($plain_mail->getFromAddress(), $mail['from']);
    $this->assertEquals($plain_mail->getFromFormatted(), $mail['reply-to']);
    $this->assertEquals($plain_mail->getLanguage(), $mail['langcode']);
    $this->assertTrue($mail['params']['plain']);

    $this->assertArrayNotHasKey('plaintext', $mail['params']);
    $this->assertArrayNotHasKey('attachments', $mail['params']);

    $this->assertEquals($plain_mail->getSubject(), $mail['subject']);
    $this->assertStringContainsString('the plain body', $mail['body']);

    // Now send an HTML message.
    $config = $this->config('simplenews.settings');
    $config->set('mail.textalt', TRUE);
    $config->save();
    $html_mail = new TestMail('html');
    \Drupal::service('simplenews.mailer')->sendMail($html_mail);
    $mails = $this->getMails();
    $mail = $mails[1];

    // Assert resulting mail.
    $this->assertEquals('simplenews_node', $mail['id']);
    $this->assertEquals('simplenews', $mail['module']);
    $this->assertEquals('node', $mail['key']);
    $this->assertEquals($plain_mail->getRecipient(), $mail['to']);
    $this->assertEquals($plain_mail->getFromAddress(), $mail['from']);
    $this->assertEquals($plain_mail->getFromFormatted(), $mail['reply-to']);
    $this->assertEquals($plain_mail->getLanguage(), $mail['langcode']);
    $this->assertEquals(NULL, $mail['params']['plain']);

    $this->assertArrayHasKey('plaintext', $mail['params']);
    $this->assertStringContainsString('the plain body', $mail['params']['plaintext']);
    $this->assertArrayHasKey('attachments', $mail['params']);
    $this->assertEquals('example://test.png', $mail['params']['attachments'][0]['uri']);

    $this->assertEquals($plain_mail->getSubject(), $mail['subject']);
    $this->assertStringContainsString('the body', $mail['body']);
  }

  /**
   * Test sending a newsletter to 100 recipients with caching enabled.
   */
  public function testSendCaching() {

    $this->setUpSubscribers(100);

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
    // Unsubscribe one of the recipients to make sure that they don't receive
    // the mail.
    \Drupal::service('simplenews.subscription_manager')->unsubscribe(array_shift($this->subscribers), $this->getRandomNewsletter());

    $before = microtime(TRUE);
    \Drupal::service('simplenews.mailer')->sendSpool();
    $after = microtime(TRUE);

    // Make sure that 99 mails have been sent.
    $this->assertCount(99, $this->getMails());

    // Test that tokens are correctly replaced.
    foreach (array_slice($this->getMails(), 0, 3) as $mail) {
      // Make sure that the same mail was used in the body token as it has been
      // sent to. Also verify that the mail is plaintext.
      $this->assertStringContainsString('*' . $mail['to'] . '*', $mail['body']);
      $this->assertStringNotContainsString('<strong>', $mail['body']);
      // Make sure the body is only attached once.
      $this->assertEquals(1, preg_match_all('/Mail token/', $mail['body'], $matches));

      $this->assertStringContainsString((string) t('Unsubscribe from this newsletter'), $mail['body']);
      // Make sure the mail has the correct unsubscribe hash.
      $hash = simplenews_generate_hash($mail['to'], 'remove');
      $this->assertStringContainsString($hash, $mail['body'], 'Correct hash is used');
      $this->assertStringContainsString($hash, $mail['headers']['List-Unsubscribe'], 'Correct hash is used in header');
    }
  }

  /**
   * Send a newsletter with the HTML format.
   */
  public function testSendHtml() {
    $this->setUpSubscribers(5);

    // Use custom testing mail system to support HTML mails.
    $mail_config = $this->config('system.mail');
    $mail_config->set('interface.default', 'test_simplenews_html_mail');
    $mail_config->save();

    // Test plain text alternative.
    $config = $this->config('simplenews.settings');
    $config->set('mail.textalt', TRUE);
    $config->save();

    // Set the format to HTML.
    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink(t('Edit'));
    $edit_newsletter = [
      'format' => 'html',
      // Use umlaut to provoke mime encoding.
      'from_name' => 'Drupäl',
      // @todo This shouldn't be necessary, default value is missing. Probably
      // should not be required.
      'from_address' => $this->randomEmail(),
      // Request a confirmation receipt.
      'receipt' => TRUE,
    ];
    $this->submitForm($edit_newsletter, 'Save');
    $this->clickLink(t('Edit'));

    $edit = [
      // Always use a character that is escaped.
      'title[0][value]' => $this->randomString() . '\'<',
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();

    // Make sure that 5 mails have been sent.
    $this->assertCount(5, $this->getMails());

    // Test that tokens are correctly replaced.
    foreach (array_slice($this->getMails(), 0, 3) as $mail) {
      // Verify title.
      preg_match('|<h2>(.*)</h2>|', $mail['body'], $matches);
      $this->assertEquals(Html::decodeEntities($matches[1]), $node->getTitle());

      // Verify the format/content type.
      $this->assertEquals('text/html', $mail['params']['format']);
      $this->assertEquals(NULL, $mail['params']['plain']);
      $this->assertEquals('text/html; charset=UTF-8', $mail['headers']['Content-Type']);

      // Make sure that the same mail was used in the body token as it has been
      // sent to.
      $this->assertStringContainsString('<strong>' . $mail['to'] . '</strong>', $mail['body']);

      // Make sure the body is only attached once.
      $this->assertEquals(1, preg_match_all('/Mail token/', $mail['body'], $matches));

      // Check the plaintext version, both params][plaintext (Mime Mail) and
      // plain (Drupal Symfony Mailer).
      $this->assertStringContainsString($mail['to'], $mail['params']['plaintext']);
      $this->assertStringNotContainsString('<strong>', $mail['params']['plaintext']);
      $this->assertEquals($mail['params']['plaintext'], $mail['plain']);
      // Make sure the body is only attached once.
      $this->assertEquals(1, preg_match_all('/Mail token/', $mail['params']['plaintext'], $matches));

      // Check the attachments and files arrays.
      $this->assertIsArray($mail['params']['attachments']);
      $this->assertEquals($mail['params']['attachments'], $mail['params']['files']);

      // Make sure formatted address is properly encoded.
      $mailbox = new MailboxHeader('From', new Address($edit_newsletter['from_address'], $edit_newsletter['from_name']));
      $from = $mailbox->getBodyAsString();
      $this->assertEquals($from, $mail['reply-to']);

      // @todo Improve this check, there are currently two spaces, not sure
      // where they are coming from.
      $this->assertStringContainsString('class="newsletter-footer"', $mail['body']);

      // Verify receipt headers.
      $this->assertEquals($edit_newsletter['from_address'], $mail['headers']['X-Confirm-Reading-To']);
      $this->assertEquals($edit_newsletter['from_address'], $mail['headers']['Disposition-Notification-To']);
    }
  }

  /**
   * Send a issue with the newsletter set to hidden.
   */
  public function testSendHidden() {
    $this->setUpSubscribers(5);

    // Set the format to HTML.
    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink(t('Edit'));
    $edit = [
      'access' => 'hidden',
      // @todo This shouldn't be necessary.
      'from_address' => $this->randomEmail(),
    ];
    $this->submitForm($edit, 'Save');

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
    // Send mails.
    \Drupal::service('simplenews.mailer')->sendSpool();

    // Make sure that 5 mails have been sent.
    $this->assertCount(5, $this->getMails());

    // Test that tokens are correctly replaced.
    foreach (array_slice($this->getMails(), 0, 3) as $mail) {
      // Verify the unsubscribe link is not displayed for hidden newsletters.
      $this->assertStringNotContainsString((string) t('Unsubscribe from this newsletter'), $mail['body']);
    }
  }

  /**
   * Test with disabled caching.
   */
  public function testSendNoCaching() {
    $this->setUpSubscribers(100);

    // Disable caching.
    $yaml = new Yaml();
    $directory = DRUPAL_ROOT . '/' . $this->siteDirectory;
    $content = file_get_contents($directory . '/services.yml');
    $services = $yaml->parse($content);
    $services['services']['simplenews.mail_cache'] = [
      'class' => 'Drupal\simplenews\Mail\MailCacheNone',
    ];
    file_put_contents($directory . '/services.yml', $yaml->dump($services));
    $this->rebuildContainer();
    \Drupal::moduleHandler()->loadAll();

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    $before = microtime(TRUE);
    \Drupal::service('simplenews.mailer')->sendSpool();
    $after = microtime(TRUE);

    // Make sure that 100 mails have been sent.
    $this->assertCount(100, $this->getMails());

    // Test that tokens are correctly replaced.
    foreach (array_slice($this->getMails(), 0, 3) as $mail) {
      $this->assertStringContainsString($node->getTitle(), $mail['body']);
      // Make sure that the same mail was used in the body token as it has been
      // sent to. Also verify that the mail is plaintext.
      $this->assertStringContainsString('*' . $mail['to'] . '*', $mail['body']);
      $this->assertStringNotContainsString('<strong>', $mail['body']);
      // Make sure the body is only attached once.
      $this->assertEquals(1, preg_match_all('/Mail token/', $mail['body'], $matches));
    }
  }

  /**
   * Test sending when the issue node is missing.
   */
  public function testSendMissingNode() {
    $this->setUpSubscribers(1);

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Delete the node manually in the database.
    \Drupal::database()->delete('node')
      ->condition('nid', $node->id())
      ->execute();
    \Drupal::database()->delete('node_revision')
      ->condition('nid', $node->id())
      ->execute();
    \Drupal::entityTypeManager()->getStorage('node')->resetCache();

    \Drupal::service('simplenews.mailer')->sendSpool();

    // Make sure that no mails have been sent.
    $this->assertCount(0, $this->getMails());

    $spool_row = \Drupal::database()->query('SELECT * FROM {simplenews_mail_spool}')->fetchObject();
    $this->assertEquals(SpoolStorageInterface::STATUS_SKIPPED, $spool_row->status);
  }

  /**
   * Test sending when there are no subscribers.
   */
  public function testSendMissingSubscriber() {
    $this->setUpSubscribers(1);

    $edit = [
      'title[0][value]' => $this->randomString(10),
      'body[0][value]' => "Mail token: <strong>[simplenews-subscriber:mail]</strong>",
      'simplenews_issue[target_id]' => 'default',
    ];
    $this->drupalGet('node/add/simplenews_issue');
    $this->submitForm($edit, 'Save');
    $this->assertEquals(1, preg_match('|node/(\d+)$|', $this->getUrl(), $matches), 'Node created');
    $node = Node::load($matches[1]);

    // Add node to spool.
    \Drupal::service('simplenews.spool_storage')->addIssue($node);

    // Delete the subscriber.
    $subscriber = Subscriber::loadByMail(reset($this->subscribers));
    $subscriber->delete();

    \Drupal::service('simplenews.mailer')->sendSpool();

    // Make sure that no mails have been sent.
    $this->assertCount(0, $this->getMails());

    $spool_row = \Drupal::database()->query('SELECT * FROM {simplenews_mail_spool}')->fetchObject();
    $this->assertEquals(SpoolStorageInterface::STATUS_SKIPPED, $spool_row->status);
  }

  /**
   * Test handling of the skip exception.
   */
  public function testSkip() {
    $this->setUpSubscribers(1);
    // Setting the body to "Nothing interesting" provokes an exception in
    // simplenews_test_mail_alter().
    $node = $this->drupalCreateNode([
      'body' => 'Nothing interesting',
      'type' => 'simplenews_issue',
      'simplenews_issue[target_id]' => ['target_id' => 'default'],
    ]);
    \Drupal::service('simplenews.spool_storage')->addIssue($node);
    \Drupal::service('simplenews.mailer')->sendSpool();
    $this->assertCount(0, $this->getMails());
    $spool_row = \Drupal::database()->select('simplenews_mail_spool', 'ms')
      ->fields('ms', ['status'])
      ->execute()
      ->fetchAssoc();
    $this->assertEquals(SpoolStorageInterface::STATUS_SKIPPED, $spool_row['status']);
  }

}
