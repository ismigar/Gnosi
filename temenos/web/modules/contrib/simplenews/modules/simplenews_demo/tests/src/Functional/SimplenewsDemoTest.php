<?php

namespace Drupal\Tests\simplenews_demo\Functional;

use Drupal\Tests\BrowserTestBase;

/**
 * Tests the demo module for Simplenews.
 *
 * @group simplenews
 */
class SimplenewsDemoTest extends BrowserTestBase {

  /**
   * Modules to enable.
   *
   * @var string[]
   */
  protected static $modules = ['simplenews_demo'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'starterkit_theme';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Log in with all relevant permissions.
    $this->drupalLogin($this->drupalCreateUser([
      'administer simplenews subscriptions', 'send newsletter', 'administer newsletters', 'administer simplenews settings',
    ]));
  }

  /**
   * Asserts the demo module has been installed successfully.
   */
  public function testInstalled() {
    // Check for the two subscription blocks.
    $this->assertSession()->pageTextContains('Simplenews multiple subscriptions');
    $this->assertSession()->pageTextContains('Stay informed - subscribe to our newsletters.');
    $this->assertSession()->pageTextContains('Simplenews subscription');
    $this->assertSession()->pageTextContains('Stay informed - subscribe to our newsletter.');

    $this->drupalGet('admin/config/services/simplenews');
    $this->clickLink(t('Edit'));
    // Assert default description is present.
    $this->assertEquals('This is an example newsletter. Change it.', $this->xpath('//textarea[@id="edit-description"]')[0]->getText());
    $from_name = $this->xpath('//input[@id="edit-from-name"]')[0];
    $from_address = $this->xpath('//input[@id="edit-from-address"]')[0];
    $this->assertEquals('Drupal', (string) $from_name->getValue());
    $this->assertEquals('simpletest@example.com', (string) $from_address->getValue());
    // Assert demo newsletters.
    $this->drupalGet('admin/config/services/simplenews');
    $this->assertSession()->pageTextContains('Press releases');
    $this->assertSession()->pageTextContains('Special offers');
    $this->assertSession()->pageTextContains('Weekly content update');
    // Assert demo newsletters sent.
    $this->drupalGet('admin/content/simplenews');
    // @codingStandardsIgnoreLine
    //$this->assertText('Scheduled weekly content newsletter issue');
    $this->assertSession()->pageTextContains('Sent press releases');
    $this->assertSession()->pageTextContains('Unpublished press releases');
    $this->assertSession()->pageTextContains('Pending special offers');
    $this->assertSession()->pageTextContains('Stopped special offers');
    // @codingStandardsIgnoreLine
    //$this->assertText('Scheduled weekly content newsletter issue - Week ');
    $this->assertSession()->responseContains('Newsletter issue sent to 2 subscribers, 0 errors.');
    $this->assertSession()->responseContains('Newsletter issue is pending, 0 mails sent out of 3, 0 errors.');
    // Weekly newsletter.
    // @codingStandardsIgnoreLine
    //$this->assertRaw(t('Newsletter issue sent to 1 subscribers, 0 errors.'));
    // Assert demo subscribers.
    $this->drupalGet('admin/people/simplenews');
    $this->assertSession()->pageTextContains('a@example.com');
    $this->assertSession()->pageTextContains('b@example.com');
    $this->assertSession()->pageTextContains('demouser1@example.com');
  }

}
