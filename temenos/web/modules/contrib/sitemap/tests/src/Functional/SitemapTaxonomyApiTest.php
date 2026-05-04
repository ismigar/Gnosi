<?php

namespace Drupal\Tests\sitemap\Functional;

use Drupal\Core\Url;
use Drupal\Tests\BrowserTestBase;
use Drupal\Tests\taxonomy\Traits\TaxonomyTestTrait;

/**
 * Test the Sitemap Vocabulary plugin API.
 *
 * @group sitemap
 */
class SitemapTaxonomyApiTest extends BrowserTestBase {
  use TaxonomyTestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['sitemap_vocabulary_api_test'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * Test the Sitemap Vocabulary plugin API.
   */
  public function testVocabularyPluginApi(): void {
    // Setup: Create a hierarchical 'genres' vocab, and add terms 1-4 to it.
    $vocab1 = $this->createVocabulary(['vid' => 'genres']);
    $vocab1Term1 = $this->createTerm($vocab1, ['name' => 'Electronic']);
    $this->createTerm($vocab1, [
      'name' => 'Deep house',
      'parent' => [$vocab1Term1->id()],
    ]);
    $this->createTerm($vocab1, ['name' => 'Jazz']);
    $this->createTerm($vocab1, ['name' => 'Pop']);

    // Setup: Create a flat 'tags' vocab, and add terms 5, 6 to it.
    $vocab2 = $this->createVocabulary(['vid' => 'tags']);
    $this->createTerm($vocab2, ['name' => 'Has lyrics']);
    $this->createTerm($vocab2, ['name' => 'Remix']);

    // Setup: Configure sitemap to display the 'genres' and 'tags' vocabs.
    $this->config('sitemap.settings')
      ->set('plugins', [
        'vocabulary:genres' => $this->vocabPluginSettings('genres', 'Genres vocab'),
        'vocabulary:tags' => $this->vocabPluginSettings('tags', 'Tags vocab'),
      ])
      ->save();

    // Setup: Log in as someone who can view the sitemap.
    $this->drupalLogin($this->drupalCreateUser([
      'access sitemap',
    ]));

    // SUT: View the sitemap.
    $this->drupalGet(Url::fromRoute('sitemap.page'));

    // Assert: We loaded the right page, and the vocab sections appear.
    $this->assertSession()->statusCodeEquals('200');
    $this->assertSession()->pageTextContains('Genres vocab');
    $this->assertSession()->pageTextContains('Tags vocab');

    // Assert: The 'genres' vocab is modified in the expected way.
    $this->assertSession()->elementTextContains('xpath', '//div[contains(@class, "sitemap-item--vocabulary-genres")]//ul/li[1]', 'Electronic with sub-terms...');
    $this->assertSession()->elementTextEquals('xpath', '//div[contains(@class, "sitemap-item--vocabulary-genres")]//ul/li[1]/ul/li[1]', 'Deep house');
    $this->assertSession()->elementTextEquals('xpath', '//div[contains(@class, "sitemap-item--vocabulary-genres")]//ul/li[2]', 'Jazz');
    $this->assertSession()->elementTextEquals('xpath', '//div[contains(@class, "sitemap-item--vocabulary-genres")]//ul/li[3]', 'Pop');

    // Assert: The 'tags' vocab is modified in the expected way.
    $this->assertSession()->pageTextNotContains('Has lyrics');
    $this->assertSession()->pageTextContains('Remix [Cool]');
  }

  /**
   * Get Vocabulary plugin settings for a given vocab and title.
   *
   * @param string $vid
   *   The vocabulary ID we're generating settings for.
   * @param string $title
   *   The title for the sitemap section.
   *
   * @return array
   *   An array of vocabulary plugin settings.
   */
  protected function vocabPluginSettings(string $vid, string $title): array {
    return [
      'id' => "vocabulary:$vid",
      'provider' => 'sitemap',
      'base_plugin' => 'vocabulary',
      'enabled' => TRUE,
      'weight' => 0,
      'settings' => [
        'title' => $title,
        'show_description' => FALSE,
        'show_count' => FALSE,
        'display_unpublished' => FALSE,
        'term_depth' => 9,
        'term_count_threshold' => 0,
        'customize_link' => FALSE,
        'term_link' => 'entity.taxonomy_term.canonical|taxonomy_term',
        'always_link' => FALSE,
        'enable_rss' => FALSE,
        'rss_link' => 'view.taxonomy_term.feed_1|arg_0',
        'rss_depth' => 9,
      ],
    ];
  }

}
