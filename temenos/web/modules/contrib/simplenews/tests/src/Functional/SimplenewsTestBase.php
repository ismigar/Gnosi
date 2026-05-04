<?php

namespace Drupal\Tests\simplenews\Functional;

use Drupal\Core\Test\AssertMailTrait;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\Tests\BrowserTestBase;
use Drupal\Tests\Traits\Core\CronRunTrait;
use Drupal\user\UserInterface;

/**
 * Base class for simplenews web tests.
 */
abstract class SimplenewsTestBase extends BrowserTestBase {

  use AssertMailTrait;
  use CronRunTrait;

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['simplenews', 'simplenews_test', 'block'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * The Simplenews settings config object.
   *
   * @var \Drupal\Core\Config\Config
   */
  protected $config;

  /**
   * Array of email addresses of test subscribers.
   *
   * @var string[]
   */
  protected $subscribers;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->drupalPlaceBlock('local_tasks_block');
    $this->drupalPlaceBlock('local_actions_block');
    $this->drupalPlaceBlock('page_title_block');
    $this->config = $this->config('simplenews.settings');

    $site_config = $this->config('system.site');
    $site_config->set('site_mail', 'simpletest@example.com');

    // The default newsletter has already been created, so we need to make sure
    // that the defaut newsletter has a valid from address.
    $newsletter = Newsletter::load('default');
    $newsletter->from_address = $site_config->get('site_mail');
    $newsletter->save();
  }

  /**
   * Generates a random email address.
   *
   * The generated addresses are stored in a class variable. Each generated
   * address is checked against this store to prevent duplicates.
   *
   * @todo Make this function redundant by modification of Simplenews.
   * Email addresses are case sensitive, simplenews system should handle with
   * this correctly.
   */
  protected function randomEmail($number = 4, $prefix = 'simpletest_', $domain = 'example.com') {
    $mail = mb_strtolower($this->randomMachineName($number, $prefix) . '@' . $domain);
    return $mail;
  }

  /**
   * Select randomly one of the available newsletters.
   *
   * @return string
   *   The ID of a newsletter.
   */
  protected function getRandomNewsletter() {
    if ($newsletters = array_keys(simplenews_newsletter_get_all())) {
      return $newsletters[array_rand($newsletters)];
    }
    return 0;
  }

  /**
   * Enable newsletter subscription block.
   *
   * @param array $settings
   *   ['newsletters'] = Array of newsletters (id => 1)
   *   ['message'] = Block message
   *   ['link_previous'] = {1, 0} Display link to previous issues
   *   ['rss_feed'] = {1, 0} Display RSS-feed icon.
   */
  protected function setupSubscriptionBlock(array $settings = []) {

    $settings += [
      'newsletters' => [],
      'message' => t('Select the newsletter(s) to which you want to subscribe or unsubscribe.'),
      'unique_id' => \Drupal::service('uuid')->generate(),
    ];

    // Simplify confirmation form submission by hiding the subscribe block on
    // that page. Same for the newsletter/subscriptions page.
    $settings['visibility']['request_path']['pages'] = "newsletter/confirm/*\nnewsletter/subscriptions";
    $settings['visibility']['request_path']['negate'] = TRUE;
    $settings['region'] = 'sidebar_first';

    return $this->drupalPlaceBlock('simplenews_subscription_block', $settings);
  }

  /**
   * Setup subscribers.
   *
   * @param int $count
   *   Number of subscribers to set up.
   * @param string $newsletter_id
   *   Newsletter ID.
   */
  protected function setUpSubscribers($count = 100, $newsletter_id = 'default') {
    // Subscribe users.
    $this->subscribers = [];
    for ($i = 0; $i < $count; $i++) {
      $mail = $this->randomEmail();
      $this->subscribers[$mail] = $mail;
    }

    $this->drupalGet('admin/people/simplenews');
    $this->clickLink(t('Mass subscribe'));
    $edit = [
      'emails' => implode(',', $this->subscribers),
      // @todo Don't hardcode the default newsletter_id.
      'newsletters[' . $newsletter_id . ']' => TRUE,
    ];
    $this->submitForm($edit, 'Subscribe');
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
    \Drupal::service('entity_display.repository')->getFormDisplay($entity_type, $bundle)
      ->setComponent($field_name, [
        'type' => 'string_textfield',
      ])->save();
    \Drupal::service('entity_display.repository')->getViewDisplay($entity_type, $bundle)
      ->setComponent($field_name, [
        'type' => 'string',
      ])->save();
  }

  /**
   * Visits and submits a newsletter management form.
   *
   * @param string|string[] $newsletter_ids
   *   An ID or an array of IDs of the newsletters to subscribe to.
   * @param string $email
   *   The email to subscribe.
   * @param array $edit
   *   (optional) Additional form field values, keyed by form field names.
   * @param int $uid
   *   (optional) User ID to update via newsletter tab.
   */
  protected function subscribe($newsletter_ids, $email = NULL, array $edit = [], $uid = NULL) {
    if (!$uid) {
      // Setup subscription block with subscription form.
      $block_settings = [
        'newsletters' => array_keys(simplenews_newsletter_get_all()),
        'message' => $this->randomMachineName(4),
      ];

      $block = $this->setupSubscriptionBlock($block_settings);
    }

    if (isset($email)) {
      $edit += [
        'mail[0][value]' => $email,
      ];
    }
    if (!is_array($newsletter_ids)) {
      $newsletter_ids = [$newsletter_ids];
    }
    foreach ($newsletter_ids as $newsletter_id) {
      $edit["subscriptions[$newsletter_id]"] = $newsletter_id;
    }
    $path = $uid ? "/user/$uid/simplenews" : '';
    $this->drupalGet($path);
    $this->submitForm($edit, $uid ? 'Save' : 'Subscribe');
    $this->assertSession()->statusCodeEquals(200);

    if (!$uid) {
      $block->delete();
    }
  }

  /**
   * Visits and submits the user registration form.
   *
   * @param string $email
   *   (optional) The email of the new user. Defaults to a random email.
   * @param array $edit
   *   (optional) Additional form field values, keyed by form field names.
   *
   * @return int
   *   Uid of the new user.
   */
  protected function registerUser($email = NULL, array $edit = []) {
    $edit += [
      'mail' => $email ?: $this->randomEmail(),
      'name' => $this->randomMachineName(),
    ];
    $this->drupalGet('user/register');
    $this->submitForm($edit, 'Create new account');
    // Return uid of new user.
    $uids = \Drupal::entityQuery('user')
      ->sort('created', 'DESC')
      ->range(0, 1)
      ->accessCheck(FALSE)
      ->execute();
    return array_shift($uids);
  }

  /**
   * Login a user, resetting their password.
   *
   * Can be used if user is unverified and does not yet have a password.
   *
   * @param \Drupal\user\UserInterface $user
   *   The user to login.
   */
  protected function resetPassLogin(UserInterface $user) {
    $uid = $user->id();
    $timestamp = \Drupal::time()->getRequestTime();
    $hash = user_pass_rehash($user, $timestamp);
    $this->drupalGet("/user/reset/$uid/$timestamp/$hash");
    $this->submitForm([], 'Log in');
  }

  /**
   * Returns the last created Subscriber.
   *
   * @return \Drupal\simplenews\Entity\Subscriber|null
   *   The Subscriber entity, or NULL if there is none.
   */
  protected function getLatestSubscriber() {
    $snids = \Drupal::entityQuery('simplenews_subscriber')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->accessCheck(FALSE)
      ->execute();
    return empty($snids) ? NULL : Subscriber::load(array_shift($snids));
  }

  /**
   * Returns the body content of mail that has been sent.
   *
   * @param int $offset
   *   Zero-based ordinal number of a sent mail. Defaults to most recent mail.
   *
   * @return string
   *   The body of the mail.
   */
  protected function getMail($offset = NULL) {
    $mails = $this->getMails();
    if (!isset($offset)) {
      $offset = count($mails) - 1;
    }
    $this->assertArrayHasKey($offset, $mails, t('Valid mails offset %offset (%count mails sent).', ['%offset' => $offset, '%count' => count($mails)]));
    return $mails[$offset]['body'];
  }

  /**
   * Checks if a string is found in the latest sent mail.
   *
   * @param string $needle
   *   The string to find.
   * @param int $offset
   *   Zero-based ordinal number of a sent mail. Defaults to most recent mail.
   * @param bool $exist
   *   (optional) Whether the string is expected to be found or not.
   */
  protected function assertMailText($needle, $offset = NULL, $exist = TRUE) {
    $body = preg_replace('/\s+/', ' ', $this->getMail($offset));
    $pos = strpos($body, (string) $needle);
    $this->assertEquals($pos !== FALSE, $exist, "$needle found in mail");
  }

  /**
   * Extract a confirmation link from a mail body.
   */
  protected function extractConfirmationLink($body, $action = 'confirm') {
    // Find url that does not contain ellipsis.
    $pattern = "@simplenews/$action/.+/.+/(?:(?!…).)*$@m";
    $found = preg_match($pattern, $body, $match);
    if (!$found) {
      $this->fail(t('No confirmation URL found in "@body".', ['@body' => $body]));
      return FALSE;
    }
    $confirm_url = $match[0];
    return $confirm_url;
  }

}
