<?php

namespace Drupal\Tests\social_media_links_field_test\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\node\Entity\NodeType;

/**
 * Tests the social media links field schema.
 *
 * @group social_media_links
 */
class SocialMediaLinksFieldSchemaTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'field',
    'node',
    'social_media_links_field',
    'social_media_links_field_test',
    'system',
    'user',
  ];

  /**
   * Tests importing fields from default config.
   */
  public function testSchema() {
    NodeType::create(['type' => 'page'])->save();
    // If schema is missed, the next command will fail.
    $this->installConfig(['social_media_links_field_test']);
  }

}
