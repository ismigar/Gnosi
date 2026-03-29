<?php

namespace Drupal\simplenews\Mail;

/**
 * Mail formatter helper.
 */
class MailFormatHelper {

  /**
   * Converts links to inline absolute URLs.
   *
   * @param string $text
   *   The mail text with HTML and special characters.
   *
   * @return string
   *   The target text with HTML and special characters replaced.
   */
  public static function inlineHyperlinks($text) {
    // By replacing <a> tag by only its URL the URLs will be placed inline
    // in the email body and are not converted to a numbered reference list
    // by MailFormatHelper::htmlToText().
    $pattern = '@<a[^>]+?href="([^"]*)"[^>]*?>(.+?)</a>@is';
    return preg_replace_callback($pattern, '\Drupal\simplenews\Mail\MailFormatHelper::absoluteMailUrls', $text);
  }

  /**
   * Replaces URLs with absolute URLs.
   */
  public static function absoluteMailUrls($match) {
    global $base_url, $base_path;
    $regexp = &drupal_static(__FUNCTION__);
    $url = $label = '';

    if ($match) {
      if (empty($regexp)) {
        $regexp = '@^' . preg_quote($base_path, '@') . '@';
      }
      [, $url, $label] = $match;
      $url = strpos($url, '://') ? $url : preg_replace($regexp, $base_url . '/', $url);

      // If the link is formed by Drupal's URL filter, we only return the URL.
      // The URL filter generates a label out of the original URL.
      if (strpos($label, '...') === mb_strlen($label) - 3) {
        // Remove ellipsis from end of label.
        $label = mb_substr($label, 0, mb_strlen($label) - 3);
      }
      if (strpos($url, $label) !== FALSE) {
        return $url;
      }
      return $label . ' ' . $url;
    }
  }

}
