<?php

namespace Drupal\vault_migration;

use Psr\Log\LoggerInterface;
use Drupal\vault_migration\Exception\VaultClientException;

/**
 * Provides reusable validation and error-handling for Vault API responses.
 */
trait VaultApiErrorTrait {

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
   * @throws VaultClientException
   *   If the data is invalid or missing keys.
   */
  protected function validateJsonResponse(mixed $data, string $context, array $requiredKeys = []): array {
    if (!is_array($data)) {
      $this->logger->error('Invalid response in @context: Expected array, got @type.', [
        '@context' => $context,
        '@type' => gettype($data),
      ]);
      throw new VaultClientException("[$context] Invalid JSON: expected array.");
    }

    foreach ($requiredKeys as $key) {
      if (!array_key_exists($key, $data)) {
        $this->logger->error('Missing key "@key" in Vault response during @context.', [
          '@key' => $key,
          '@context' => $context,
        ]);
        throw new VaultClientException("[$context] Missing expected key: $key.");
      }
    }

    return $data;
  }
}
