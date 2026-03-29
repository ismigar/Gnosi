<?php

namespace Drupal\social_media_links\Plugin\SocialMediaLinks\Iconset;

use Drupal\social_media_links\IconsetBase;
use Drupal\social_media_links\IconsetInterface;

/**
 * Provides 'icoMoon' iconset.
 *
 * @Iconset(
 *   id = "icoMoon",
 *   name = "IcoMoon - Icon packs",
 *   publisher = "IcoMoon",
 *   publisherUrl = "https://www.icomoon.io/",
 *   downloadUrl = "https://www.icomoon.io/#icons-icomoon",
 * )
 */
class IcoMoon extends IconsetBase implements IconsetInterface {

  /**
   * {@inheritdoc}
   */
  public function getStyle() {
    return [
      '16' => '16x16',
      '32' => '32x32',
      '48' => '48x48',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getIconPath($icon_name, $style) {
    return $this->path . '/PNG/' . $icon_name . '.png';
  }

}
