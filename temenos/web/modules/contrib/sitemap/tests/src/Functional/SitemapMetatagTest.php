<?php

declare(strict_types=1);

use Drupal\Tests\sitemap\Functional\SitemapTestBase;

/**
 * Tests the metatag settings for sitemap page.
 *
 * @group sitemap
 */
class SitemapMetatagTest extends SitemapTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['metatag', 'sitemap', 'sitemap_metatag'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    // Setup: Log in with permission to view and administer the sitemap.
    $this->drupalLogin($this->drupalCreateUser([
      'administer sitemap',
      'access sitemap',
    ]));
  }

  /**
   * Test sitemap_metatag defaults, and that it is possible to change them.
   */
  public function testSitemapMetatag(): void {
    // SUT: Load the sitemap.
    $this->drupalGet('/sitemap');

    // Assert: Check that the meta tags match the defaults installed by the
    // sitemap_metatag submodule.
    $this->assertSession()->responseContains('<title>Sitemap | Drupal</title>');
    $xpath = $this->xpath("//link[@rel='canonical']");
    self::assertStringEndsWith('/sitemap', (string) $xpath[0]->getAttribute('href'));

    // Setup: Change the meta tags for the sitemap page.
    $this->saveSitemapForm([
      'page_title' => 'Sitemap Test',
      'path' => 'sitemap_test',
    ]);

    // SUT: Load the sitemap.
    $this->drupalGet('/sitemap_test');

    // Assert: Check that the meta tags have been changed too.
    $this->assertSession()->responseContains('<title>Sitemap test | Drupal</title>');
    $xpath = $this->xpath("//link[@rel='canonical']");
    self::assertStringEndsWith('/sitemap_test', (string) $xpath[0]->getAttribute('href'));
  }

  /**
   * Test adding a description meta tag to the sitemap.
   */
  public function testMetaDescription(): void {
    // Setup: Install the metatag_routes module.
    $this->container->get('module_installer')->install(['metatag_routes']);

    // Setup: Set a meta description.
    $description = $this->getRandomGenerator()->sentences(5);
    $this->config('metatag.metatag_defaults.sitemap.page')
      ->set('tags.description', $description)
      ->save();

    // SUT: Load the sitemap.
    $this->drupalGet('/sitemap');

    // Assert: Find the meta description in the output.
    $xpath = $this->xpath('//meta[@name="description"]');
    $this->assertEquals($description, $xpath[0]->getAttribute('content'));
  }

}
