<?php

namespace Drupal\Tests\simplenews\Functional;

/**
 * Tests integration with field_ui.
 *
 * @group simplenews
 */
class SimplenewsFieldUiTest extends SimplenewsTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['field_ui', 'help'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->drupalPlaceBlock('help_block');
  }

  /**
   * Test that a new content type has a simplenews_issue field.
   */
  public function testContentTypeCreation() {
    $admin_user = $this->drupalCreateUser([
      'administer blocks',
      'administer content types',
      'administer nodes',
      'administer node fields',
      'administer node display',
      'access administration pages',
      'administer permissions',
      'administer newsletters',
      'administer simplenews subscriptions',
      'administer simplenews settings',
      'bypass node access',
      'send newsletter',
    ]);
    $this->drupalLogin($admin_user);

    $this->drupalGet('admin/structure/types');
    $this->clickLink(t('Add content type'));
    $name = 'simplenews_issue';
    $type = strtolower($name);
    $edit = [
      'name' => $name,
      'type' => $type,
      'simplenews_content_type' => TRUE,
    ];
    $this->submitForm($edit, 'Save and manage fields');
    $this->drupalGet('admin/structure/types/manage/' . $type . '/fields');
    $this->assertSession()->pageTextContains('simplenews_issue');
    // Check if the help text is displayed.
    $this->drupalGet('admin/structure/types/manage/' . $type . '/display');
    $this->assertSession()->pageTextContains("'Email:HTML' display settings apply to the HTML content of emails");
    $this->drupalGet('admin/config/services/simplenews/settings/newsletter');
    $this->assertSession()->pageTextContains('These settings are default to all newsletters. Newsletter specific settings');
  }

}
