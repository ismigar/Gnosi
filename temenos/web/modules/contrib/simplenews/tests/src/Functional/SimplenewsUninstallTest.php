<?php

namespace Drupal\Tests\simplenews\Functional;

/**
 * Tests that Simplenews module can be uninstalled.
 *
 * @group simplenews
 */
class SimplenewsUninstallTest extends SimplenewsTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    \Drupal::service('module_installer')->uninstall(['simplenews_test']);

    $admin_user = $this->drupalCreateUser([
      'administer nodes',
      'administer simplenews settings',
      'administer simplenews subscriptions',
      'create simplenews_issue content',
      'administer modules',
    ]);
    $this->drupalLogin($admin_user);

    // Subscribe a user.
    $this->setUpSubscribers(1);
  }

  /**
   * Tests that Simplenews module can be uninstalled.
   */
  public function testUninstall() {

    // Add a newsletter issue.
    $this->drupalCreateNode(['type' => 'simplenews_issue', 'label' => $this->randomMachineName()])->save();

    // Delete Simplenews data.
    $this->drupalGet('admin/config/services/simplenews/settings/uninstall');
    $this->submitForm([], 'Delete Simplenews data');
    $this->assertSession()->pageTextContains('Simplenews data has been deleted.');

    // Uninstall the module.
    $this->drupalGet('admin/modules/uninstall');
    $this->submitForm(['uninstall[simplenews]' => TRUE], 'Uninstall');
    $this->submitForm([], 'Uninstall');
    $this->assertSession()->pageTextContains('The selected modules have been uninstalled.');
    $this->assertSession()->pageTextNotContains('Simplenews');

    // Make sure that the module can be installed again.
    $this->drupalGet('admin/modules');
    $this->submitForm(['modules[simplenews][enable]' => TRUE], 'Install');
    $this->assertSession()->pageTextContains('Module Simplenews has been installed.');
  }

}
