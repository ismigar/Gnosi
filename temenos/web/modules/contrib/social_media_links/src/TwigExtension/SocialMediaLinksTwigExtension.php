<?php

namespace Drupal\social_media_links\TwigExtension;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;

/**
 * Twig filter to allow uri parameters to be added to social media links.
 */
class SocialMediaLinksTwigExtension extends AbstractExtension {

  /**
   * Generates a list of all Twig filters that this extension defines.
   */
  public function getFilters() {
    return [
      new TwigFilter('safe_link', [$this, 'safeLinkFilter']),
    ];
  }

  /**
   * Provides a Twig filter callback for safe URL creation.
   */
  public function safeLinkFilter($url) {
    // Decode the URL first.
    $url = urldecode($url);

    // Replace '&amp;' with '&'.
    $url = str_replace('&amp;', '&', $url);

    $url_parts = parse_url($url);

    // If we don't have query parameters, just return the original URL.
    if (!isset($url_parts['query'])) {
      return $url;
    }

    parse_str($url_parts['query'], $query_array);

    // Re-encode the query parameters.
    $safe_query = http_build_query($query_array);

    // Rebuild the URL.
    $safe_url = $url_parts['scheme'] . '://' . $url_parts['host'] . $url_parts['path'] . '?' . $safe_query;

    if (isset($url_parts['fragment'])) {
      // Encode the fragment.
      $safe_url .= '#' . urlencode($url_parts['fragment']);
    }

    return $safe_url;
  }

}
