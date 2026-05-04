<?php

namespace Drupal\sitemap\Attribute;

use Drupal\Component\Plugin\Attribute\Plugin;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The Sitemap attribute.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
class Sitemap extends Plugin {

  /**
   * Constructs a Sitemap attribute.
   *
   * @param string $id
   *   The plugin ID.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|null $title
   *   The human-readable name of the plugin.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|null $description
   *   A short description of the plugin.
   * @param int $weight
   *   Sets the weight of this item relative to other items in the sitemap.
   * @param bool $enabled
   *   Whether this plugin is enabled or disabled by default.
   * @param array $settings
   *   The default settings for the plugin.
   * @param string|null $deriver
   *   The deriver for menu and vocabulary plugins.
   * @param string|null $menu
   *   Menu name.
   * @param string|null $vocabulary
   *   Vocabulary name.
   */
  public function __construct(
    public readonly string $id,
    public readonly ?TranslatableMarkup $title = NULL,
    public readonly ?TranslatableMarkup $description = NULL,
    public readonly int $weight = 0,
    public readonly bool $enabled = FALSE,
    public readonly array $settings = [],
    public readonly ?string $deriver = NULL,
    public readonly ?string $menu = NULL,
    public readonly ?string $vocabulary = NULL,
  ) {}

}
