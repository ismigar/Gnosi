<?php

namespace Drupal\social_media_links\Plugin\SocialMediaLinks\Platform;

use Drupal\social_media_links\PlatformBase;

/**
 * Provides 'Mastodon' platform.
 *
 * @Platform(
 *   id = "mastodon",
 *   name = @Translation("Mastodon"),
 *   urlPrefix = "https://",
 * )
 */
class Mastodon extends PlatformBase {}
