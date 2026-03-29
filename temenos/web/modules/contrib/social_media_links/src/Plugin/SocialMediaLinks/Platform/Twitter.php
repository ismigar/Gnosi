<?php

namespace Drupal\social_media_links\Plugin\SocialMediaLinks\Platform;

use Drupal\social_media_links\PlatformBase;

/**
 * Provides 'twitter' platform.
 *
 * @Platform(
 *   id = "twitter",
 *   name = @Translation("X"),
 *   iconName = "x-twitter",
 *   description = @Translation("Previously known as Twitter."),
 *   urlPrefix = "https://x.com/",
 * )
 */
class Twitter extends PlatformBase {}
