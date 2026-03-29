<?php

declare(strict_types=1);

namespace Drupal\Tests\tvp\Kernel;

use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\Traits\Core\PathAliasTestTrait;
use Drupal\node\Entity\Node;
use Drupal\node\Entity\NodeType;
use Drupal\pathauto\Entity\PathautoPattern;

/**
 * A test class for TVP Processor Path functionality.
 *
 * This class extends KernelTestBase to leverage the Drupal testing framework.
 * The test includes various modules essential for testing the TVP Processor's
 * path-related features.
 *
 * @group tvp
 */
class TvpProcessorPathTest extends KernelTestBase {

  use PathAliasTestTrait;

  /**
   * Modules to install.
   *
   * @var array|string[]
   */
  protected static $modules = [
    'content_translation',
    'config_translation',
    'field',
    'filter',
    'language',
    'locale',
    'file',
    'node',
    'path',
    'path_alias',
    'pathauto',
    'system',
    'text',
    'token',
    'tvp',
    'user',
    'views',
    'tvp_test',
    'datetime',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installEntitySchema('node');
    $this->installEntitySchema('user');
    $this->installEntitySchema('path_alias');
    $this->installEntitySchema('pathauto_pattern');
    $this->installSchema('node', 'node_access');
    $this->installConfig(['tvp_test']);
  }

  /**
   * Tests the TVP processor paths for various configurations and translations.
   *
   * This method sets up date formats, node types, configuration values,
   * language overrides, path aliases, and pathauto patterns. It then creates
   * a node and its translation, verifying that the correct path alias is
   * generated for the translated node.
   *
   * @return void
   *   Void.
   */
  public function testTvpProcessorPaths(): void {
    // Create a fallback date format, for some reason this was required.
    DateFormat::create([
      'id' => 'fallback',
      'label' => 'Fallback',
      'pattern' => 'Y-m-d',
    ])->save();

    // Create a node type 'abc' to use for testing.
    NodeType::create([
      'type' => 'abc',
      'name' => 'abc',
    ])->save();

    $config_name = 'views.view.program';

    // Retrieve necessary services for configuration and language management.
    $config_manager = \Drupal::service('config.typed');
    $config_factory = \Drupal::service('config.factory');
    $language_manager = \Drupal::service('language_manager');

    // Fetch the configuration schema.
    $schema = $config_manager->get($config_name);

    // Get the base configuration and the language override for Norwegian.
    $base_config = $config_factory->getEditable($config_name);
    $config_translation = $language_manager->getLanguageConfigOverride('nb', $config_name);

    // Save the translated configuration.
    $config_translation->save();

    // Create a path alias '/programmes' for the Norwegian language.
    // This is the edge case that causes the bug.
    // When run through pathauto hooks, this 'programmes' is rewritten as
    // cspell:disable-line 'programmesmes'.
    $this->createPathAlias('/program', '/programmes', 'nb');

    // Define and save a Pathauto pattern for the English language.
    // This causes nodes in the base language to get the path
    // '/program/test'.
    $pathauto_config = PathautoPattern::create([
      'id' => 'program',
      'label' => 'Program',
      'type' => 'canonical_entities:node',
      'pattern' => '/program/[node:title]',
      'status' => 1,
      'weight' => 0,
      'bundles' => ['abc' => 'abc'],
      'langcode' => 'en',
      'dependencies' => [
        'module' => [
          'language',
          'node',
        ],
      ],
      'relationships' => [
        'node:langcode:language' => ['label' => 'Language'],
      ],
      'languages' => ['en' => 'en'], ['nb' => 0],
    ]);
    $pathauto_config->addSelectionCondition([
      'id' => 'entity_bundle:node',
      'bundles' => ['abc' => 'abc'],
      'context_mapping' => ['node' => 'node'],
      'negate' => FALSE,
    ]);
    $pathauto_config->addSelectionCondition([
      'id' => 'language',
      'langcodes' => ['en' => 'en'],
      'context_mapping' => ['language' => 'node:langcode:language'],
      'negate' => FALSE,
    ]);
    $pathauto_config->save();

    // Define and save a Pathauto pattern for the Norwegian language.
    // This causes nodes in the base language to get the path
    // '/programmes/test'.
    $pathauto_config = PathautoPattern::create([
      'id' => 'programmes',
      'label' => 'Programmes',
      'type' => 'canonical_entities:node',
      'pattern' => '/programmes/[node:title]',
      'status' => 1,
      'weight' => 0,
      'bundles' => ['abc' => 'abc'],
      'langcode' => 'en',
      'dependencies' => [
        'module' => [
          'language',
          'node',
        ],
      ],
      'relationships' => [
        'node:langcode:language' => ['label' => 'Language'],
      ],
      'languages' => ['nb' => 'nb'], ['en' => 0],
    ]);
    $pathauto_config->addSelectionCondition([
      'id' => 'entity_bundle:node',
      'bundles' => ['abc' => 'abc'],
      'context_mapping' => ['node' => 'node'],
      'negate' => FALSE,
    ]);
    $pathauto_config->addSelectionCondition([
      'id' => 'language',
      'langcodes' => ['nb' => 'nb'],
      'context_mapping' => ['language' => 'node:langcode:language'],
      'negate' => FALSE,
    ]);
    $pathauto_config->save();

    // Create a node of type 'abc' with the title 'test' in English.
    $node = Node::create([
      'type' => 'abc',
      'title' => 'test',
      'langcode' => 'en',
    ]);
    $node->save();

    // Add a Norwegian translation to the created node.
    $translated_node = $node->addTranslation('nb');
    $translated_node->title->value = 'test Norwegian';
    $translated_node->save();

    // Assert that the path alias for the translated node is correctly
    // generated. The bug caused the path to be rewritten as
    // cspell:disable-line 'programmesmes/test'.
    $this->assertEquals('/program/test',
      Url::fromRoute('entity.node.canonical', ['node' => $node->id()], ['language' => \Drupal::languageManager()->getLanguage('en')])->toString()
    );

    // Assert that the path alias for the original node is correctly generated.
    $this->assertEquals('/programmes/testNorwegian',
      Url::fromRoute('entity.node.canonical', ['node' => $translated_node->id()], ['language' => \Drupal::languageManager()->getLanguage('nb')])->toString()
    );

    $view_english_uri = Url::fromRoute('view.program.page_1', [], ['language' => \Drupal::languageManager()->getLanguage('en')])->toString();
    $this->assertEquals('/program', $view_english_uri);

    $view_norwegian_uri = Url::fromRoute('view.program.page_1', [], ['language' => \Drupal::languageManager()->getLanguage('nb')])->toString();
    $this->assertEquals('/programmes', $view_norwegian_uri);

  }

}
