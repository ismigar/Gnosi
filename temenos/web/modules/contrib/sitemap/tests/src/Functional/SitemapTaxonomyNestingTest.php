<?php

namespace Drupal\Tests\sitemap\Functional;

use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\node\NodeTypeInterface;
use Drupal\taxonomy\TermInterface;
use Drupal\taxonomy\VocabularyInterface;
use Drupal\Tests\BrowserTestBase;
use Drupal\Tests\field\Traits\EntityReferenceFieldCreationTrait;
use Drupal\Tests\taxonomy\Traits\TaxonomyTestTrait;

/**
 * Test that all terms are output, even in highly-nested vocabularies.
 *
 * @group sitemap
 */
class SitemapTaxonomyNestingTest extends BrowserTestBase {
  use EntityReferenceFieldCreationTrait;
  use TaxonomyTestTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['sitemap', 'node', 'taxonomy'];

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * The type of nodes that should be created in the test.
   *
   * @var \Drupal\node\NodeTypeInterface
   */
  protected NodeTypeInterface $nodeType;

  /**
   * A vocabulary to use in the test.
   *
   * @var \Drupal\taxonomy\VocabularyInterface
   */
  protected VocabularyInterface $vocab;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    // Setup: Create a vocabulary.
    $this->vocab = $this->createVocabulary();
    $vid = $this->vocab->id();

    // Setup: Create a content type with a term reference field.
    $this->nodeType = $this->drupalCreateContentType();
    $this->addTermReferenceField($this->nodeType, 'field_tags');

    // Setup: Configure the sitemap to show the vocabulary.
    \Drupal::configFactory()->getEditable('sitemap.settings')
      ->set('path', '/sitemap')
      ->set('plugins', [
        "vocabulary:$vid" => [
          'id' => "vocabulary:$vid",
          'provider' => 'sitemap',
          'base_plugin' => 'vocabulary',
          'enabled' => TRUE,
          'settings' => [
            'title' => NULL,
            'show_description' => FALSE,
            'show_count' => TRUE,
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
        ],
      ])
      ->save();
  }

  /**
   * Test that all terms are output, even in highly-nested vocabularies.
   */
  public function testAllTermsDisplayedInHighlyNestedVocab(): void {
    // Setup: Log in as a user with permission to view the sitemap.
    $this->drupalLogin($this->createUser(['access sitemap']));

    // Setup: Create terms in 9 levels.
    [$term1] = $this->createTermsAndTagNodes(NULL, '1', 1);
    [
      $term1_1,
      $term1_2,
      $term1_4,
      $term1_3,
      $term1_5,
      $term1_6,
      $term1_7,
      $term1_8,
    ] = $this->createTermsAndTagNodes($term1, '1.1', 8);
    [$term1_1_1] = $this->createTermsAndTagNodes($term1_1, '1.1.1', 1);
    [$term1_2_1] = $this->createTermsAndTagNodes($term1_2, '1.2.1', 1);
    [$term1_3_1] = $this->createTermsAndTagNodes($term1_3, '1.3.1', 1);
    [$term1_4_1] = $this->createTermsAndTagNodes($term1_4, '1.4.1', 1);
    [$term1_5_1] = $this->createTermsAndTagNodes($term1_5, '1.5.1', 1);
    [$term1_6_1] = $this->createTermsAndTagNodes($term1_6, '1.6.1', 1);
    [$term1_7_1] = $this->createTermsAndTagNodes($term1_7, '1.7.1', 1);
    [$term1_8_1, $term1_8_2, $term1_8_3] = $this->createTermsAndTagNodes($term1_8, '1.8.1', 3);

    // Run SUT: Visit the sitemap.
    $this->drupalGet('/sitemap');

    // Assert: Ensure that the terms we sampled in each level are visible.
    $this->assertSession()->pageTextContains($term1->label());
    $this->assertSession()->pageTextContains($term1_1->label());
    $this->assertSession()->pageTextContains($term1_1_1->label());
    $this->assertSession()->pageTextContains($term1_2->label());
    $this->assertSession()->pageTextContains($term1_2_1->label());
    $this->assertSession()->pageTextContains($term1_3->label());
    $this->assertSession()->pageTextContains($term1_3_1->label());
    $this->assertSession()->pageTextContains($term1_4->label());
    $this->assertSession()->pageTextContains($term1_4_1->label());
    $this->assertSession()->pageTextContains($term1_5->label());
    $this->assertSession()->pageTextContains($term1_5_1->label());
    $this->assertSession()->pageTextContains($term1_6->label());
    $this->assertSession()->pageTextContains($term1_6_1->label());
    $this->assertSession()->pageTextContains($term1_7->label());
    $this->assertSession()->pageTextContains($term1_7_1->label());
    $this->assertSession()->pageTextContains($term1_8->label());
    $this->assertSession()->pageTextContains($term1_8_1->label());
    $this->assertSession()->pageTextContains($term1_8_2->label());
    $this->assertSession()->pageTextContains($term1_8_3->label());
  }

  /**
   * Add a taxonomy term reference field for the given content type.
   *
   * @param \Drupal\node\NodeTypeInterface $nodeType
   *   The content type to add the term reference field to.
   * @param string $fieldName
   *   The machine name of the term reference field to create.
   */
  protected function addTermReferenceField(NodeTypeInterface $nodeType, string $fieldName): void {
    $entityTypeId = 'node';
    $bundleId = $nodeType->id();

    $this->createEntityReferenceField(
      $entityTypeId,
      $bundleId,
      $fieldName,
      $fieldName,
      'taxonomy_term',
      'default',
      [
        'target_bundles' => [
          $this->vocab->id() => $this->vocab->id(),
        ],
        'auto_create' => TRUE,
      ],
      FieldStorageDefinitionInterface::CARDINALITY_UNLIMITED
    );
    \Drupal::service('entity_display.repository')
      ->getFormDisplay($entityTypeId, $bundleId)
      ->setComponent($fieldName)
      ->save();
  }

  /**
   * Create taxonomy terms, and nodes tagged with those terms.
   *
   * @param \Drupal\taxonomy\TermInterface|null $parent
   *   The parent term to use for the terms created. Leave NULL to create terms
   *   at the top level of the vocabulary.
   * @param string $termNamePrefix
   *   Text to prefix the term name with: prefixing the term level can help with
   *   debugging.
   * @param int $numTerms
   *   The number of sub-terms to generate.
   *
   * @return \Drupal\taxonomy\TermInterface[]
   *   The terms created by the function.
   */
  protected function createTermsAndTagNodes(?TermInterface $parent, string $termNamePrefix = '', int $numTerms = 1): array {
    $terms = [];

    \assert($numTerms > 0, '$numTerms must be greater than 0.');

    // Generate a random number of terms.
    for ($termCursor = 0; $termCursor < $numTerms; $termCursor++) {
      // Create a term. If a name prefix is specified, use it. If a parent term
      // is given, use it.
      $termValues = [];
      if (!empty($termNamePrefix)) {
        $termValues['name'] = sprintf('%s-T%s - %s', $termNamePrefix, $termCursor, $this->randomMachineName());
      }
      if ($parent instanceof TermInterface) {
        $termValues['parent'] = $parent->id();
      }
      $term = $this->createTerm($this->vocab, $termValues);

      // Generate a random number of nodes tagged with the term.
      $numNodes = \random_int(1, 4);
      for ($nodeCursor = 0; $nodeCursor < $numNodes; $nodeCursor++) {
        $this->drupalCreateNode([
          'type' => $this->nodeType->id(),
          'title' => $this->randomMachineName(),
          'field_tags' => [$term],
        ]);
      }

      $terms[] = $term;
    }

    return $terms;
  }

}
