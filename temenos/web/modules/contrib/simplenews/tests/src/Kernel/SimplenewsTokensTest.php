<?php

namespace Drupal\Tests\simplenews\Kernel;

use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\simplenews\Entity\Newsletter;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\Tests\token\Functional\TokenTestTrait;

/**
 * Test the tokens replacements.
 *
 * @group simplenews
 */
class SimplenewsTokensTest extends KernelTestBase {

  use TokenTestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'token',
    'node',
    'user',
    'simplenews',
  ];

  /**
   * The newsletter.
   *
   * @var \Drupal\simplenews\NewsletterInterface
   */
  protected $newsletter;

  /**
   * The subscriber.
   *
   * @var \Drupal\simplenews\SubscriberInterface
   */
  protected $subscriber;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installConfig(['system']);
    $this->installEntitySchema('user');
    $this->installEntitySchema('simplenews_subscriber');
    $this->installEntitySchema('simplenews_subscriber_history');

    $subscriber = Subscriber::create(['mail' => 'user@example.com']);
    $subscriber->save();
    $this->subscriber = $subscriber;

    $newsletter = Newsletter::create(['id' => 'test']);
    $newsletter->save();
    $this->newsletter = $newsletter;
  }

  /**
   * Checks cases when a subscriber or newsletter is not passed.
   */
  public function testSimplenewsSubscriberTokensWithoutPassedEntity() {
    $data = [];
    $tokens = ['unsubscribe-url', 'combined-url', 'confirm-url', 'manage-url', 'mail'];
    $this->assertNoTokens('simplenews-subscriber', $data, $tokens);
  }

  /**
   * Checks cases when a subscriber or newsletter is invalid or not created.
   */
  public function testSimplenewsSubscriberUnsubscribeUrlWithoutEntitites() {
    $data = [];
    $tokens = ['unsubscribe-url'];

    $data['simplenews_subscriber'] = Subscriber::create();
    $this->assertNoTokens('simplenews-subscriber', $data, $tokens);

    $data['newsletter'] = Newsletter::create();
    $this->assertNoTokens('simplenews-subscriber', $data, $tokens);
  }

  /**
   * Checks for correct subscriber token replacement.
   *
   * @dataProvider simplenewsSubscriberActionUrlTokensDataProvider
   */
  public function testSimplenewsSubscriberActionUrlTokens($token, $action, $subscriber_langcode, $expected_uri_pattern) {
    if ($subscriber_langcode !== NULL) {
      $this->subscriber->setLangcode($subscriber_langcode);
    }

    $request_time = $this->container->get('datetime.time')->getRequestTime();
    $hash = simplenews_generate_hash($this->subscriber->getMail(), $action, $request_time);

    $expected_url = strtr($expected_uri_pattern, [
      '%subscriber_id' => $this->subscriber->id(),
      '%newsletter_id' => $this->newsletter->id(),
      '%request_time' => $request_time,
      '%hash' => $hash,
    ]);

    $expected_url = Url::fromUri($expected_url)->setAbsolute()->toString();

    $data['simplenews_subscriber'] = $this->subscriber;
    $data['newsletter'] = $this->newsletter;
    $this->assertToken('simplenews-subscriber', $data, $token, $expected_url);
  }

  /**
   * A data provider for subscriber action url tokens test cases.
   *
   * @return array
   *   An array of test cases.
   */
  public function simplenewsSubscriberActionUrlTokensDataProvider() {
    // $token, $action, $subscriber_langcode, $expected_uri_pattern.
    return [
      ['unsubscribe-url', 'remove', NULL, 'base:/simplenews/remove/%subscriber_id/%newsletter_id/%request_time/%hash'],
      ['confirm-url', 'confirm', NULL, 'base:/simplenews/confirm/%subscriber_id/%request_time/%hash'],
      ['manage-url', 'manage', NULL, 'base:/simplenews/manage/%subscriber_id/%request_time/%hash'],
    ];
  }

  /**
   * Checks for correct subscriber token replacement.
   */
  public function testSimplenewsSubscriberMailToken() {
    $data['simplenews_subscriber'] = $this->subscriber;
    $this->assertToken('simplenews-subscriber', $data, 'mail', 'user@example.com');
  }

  /**
   * Checks case when a newsletter is not passed.
   */
  public function testSimplenewsNewsletterTokensWithoutPassedEntity() {
    $data = [];
    $tokens = ['name', 'url'];
    $this->assertNoTokens('simplenews-newsletter', $data, $tokens);
  }

  /**
   * Checks for correct newsletter name token replacement.
   *
   * @dataProvider simplenewsNewsletterNameTokenDataProvider
   */
  public function testSimplenewsNewsletterNameToken($newsletter_name, $subscriber_langcode, $expected_name) {
    if ($subscriber_langcode !== NULL) {
      $this->subscriber->setLangcode($subscriber_langcode);
    }

    if (!empty($newsletter_name)) {
      $this->newsletter->set('name', $newsletter_name);
    }

    $data['newsletter'] = $this->newsletter;
    $options = ['langcode' => $subscriber_langcode];

    $this->assertToken('simplenews-newsletter', $data, 'name', $expected_name, $options);
  }

  /**
   * A data provider for newsletter name test cases.
   *
   * @return array
   *   An array of test cases.
   */
  public function simplenewsNewsletterNameTokenDataProvider() {
    // $newsletter_name, $subscriber_langcode, $expected_name.
    return [
      [NULL, NULL, 'Unassigned newsletter'],
      ['', NULL, 'Unassigned newsletter'],
      ['Example', NULL, 'Example'],
    ];
  }

}
