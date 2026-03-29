<?php

/**
 * @file
 * Hooks specific to the Sitemap module.
 *
 * @phpstan-type SitemapVocabularyFlatTermInfo array{data: array}
 * @phpstan-type SitemapVocabularyHierarchicalTermInfo array{int: array, children?: array}
 */

/**
 * Alter taxonomy terms before they are displayed on the sitemap.
 *
 * @param array<string|int, SitemapVocabularyFlatTermInfo|SitemapVocabularyHierarchicalTermInfo> &$list
 *   An array of taxonomy term data intended for use in an item_list element.
 *   The keys of the outer array are term IDs, and the values are associative
 *   arrays.
 *   If the vocabulary is flat (i.e.: VocabularyInterface::HIERARCHY_DISABLED),
 *   then the array looks like:
 *   - TERM_ID: An associative array containing:
 *     - data: A render array for a term.
 *   If the vocabulary is hierarchical
 *   (i.e.: VocabularyInterface::HIERARCHY_SINGLE), then the array looks like:
 *   - TERM_ID: An associative array containing:
 *     - 0: A render array for a term.
 *     - children (optional): An associative array containing:
 *       - TERM_ID: An associative array containing:
 *         - 0: A render array for a term.
 *         - children (optional): An associative array.
 * @param string $vid
 *   The ID of the vocabulary being displayed.
 *
 * @see \Drupal\sitemap\Plugin\Sitemap\Vocabulary::view()
 * @see \template_preprocess_item_list()
 */
function hook_sitemap_vocabulary_alter(array &$list, string $vid): void {
  if ($vid === 'flat_vid') {
    // Hide term with ID 1234.
    if (\array_key_exists(1234, $list)) {
      unset($list[1234]);
    }

    // Add a string to the end of every term with an even term ID.
    foreach ($list as $tid => $termContainer) {
      if ($tid % 2 === 0) {
        $list[$tid]['data']['#name'] .= ' ' . t('[Cool]');
      }
    }
  }

  if ($vid === 'tree_vid') {
    // Add text between each top-level term and its sub-terms.
    foreach ($list as $key => $value) {
      if (isset($value['children'])) {
        $list[$key][] = ['#markup' => ' ' . t('with sub-terms...')];

        // We have to give the sub-term list a weight so it "sinks" below the
        // new text.
        $list[$key]['children']['#weight'] = 10;
      }
    }
  }
}

/**
 * Alter taxonomy terms in a vocab before they are displayed on the sitemap.
 *
 * @param array<string|int, SitemapVocabularyFlatTermInfo|SitemapVocabularyHierarchicalTermInfo> &$list
 *   An array of taxonomy term data intended for use in an item_list element.
 *   The keys of the outer array are term IDs, and the values are associative
 *   arrays.
 *   If the vocabulary is flat (i.e.: VocabularyInterface::HIERARCHY_DISABLED),
 *   then the array looks like:
 *   - TERM_ID: An associative array containing:
 *     - data: A render array for a term.
 *   If the vocabulary is hierarchical
 *   (i.e.: VocabularyInterface::HIERARCHY_SINGLE), then the array looks like:
 *   - TERM_ID: An associative array containing:
 *     - 0: A render array for a term.
 *     - children (optional): An associative array containing:
 *       - TERM_ID: An associative array containing:
 *         - 0: A render array for a term.
 *         - children (optional): An associative array.
 * @param string $vid
 *   The ID of the vocabulary being displayed.
 *
 * @see \Drupal\sitemap\Plugin\Sitemap\Vocabulary::view()
 * @see \template_preprocess_item_list()
 */
function hook_sitemap_vocabulary_VID_alter(array &$list, string $vid): void {
  // Hide term with ID 1234.
  if (\array_key_exists(1234, $list)) {
    unset($list[1234]);
  }

  // Add a string to the end of every term with an even term ID.
  foreach ($list as $tid => $termContainer) {
    if ($tid % 2 === 0) {
      $list[$tid]['data']['#name'] = ' ' . t('[Cool]');
    }
  }
}
