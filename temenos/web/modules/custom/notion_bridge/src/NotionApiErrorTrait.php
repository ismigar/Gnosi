<?php

namespace Drupal\notion_bridge;

use Psr\Log\LoggerInterface;
use Drupal\notion_bridge\Exception\NotionClientException;

/**
 * Provides reusable validation and error-handling for Notion API responses.
 */
trait NotionApiErrorTrait {

  protected LoggerInterface $logger;

  /**
   * Validates that decoded JSON is an array and contains required fields.
   *
   * @param mixed $data
   *   The decoded JSON data.
   * @param string $context
   *   Context string for error messages (e.g. method name).
   * @param array $requiredKeys
   *   Keys that must exist in $data.
   *
   * @return array
   *   The validated array.
   *
   * @throws NotionClientException
   *   If the data is invalid or missing keys.
   */
  protected function validateJsonResponse(mixed $data, string $context, array $requiredKeys = []): array {
    if (!is_array($data)) {
      $this->logger->error('Invalid response in @context: Expected array, got @type.', [
        '@context' => $context,
        '@type' => gettype($data),
      ]);
      throw new NotionClientException("[$context] Invalid JSON: expected array.");
    }

    foreach ($requiredKeys as $key) {
      if (!array_key_exists($key, $data)) {
        $this->logger->error('Missing key "@key" in Notion response during @context.', [
          '@key' => $key,
          '@context' => $context,
        ]);
        throw new NotionClientException("[$context] Missing expected key: $key.");
      }
    }

    return $data;
  }
}
