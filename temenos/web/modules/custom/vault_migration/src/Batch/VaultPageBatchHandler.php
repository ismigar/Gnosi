<?php

namespace Drupal\vault_migration\Batch;

use Drupal\vault_migration\VaultClient;
use Drupal\vault_migration\ContentImporter;
use Psr\Log\LoggerInterface;

/**
 * Handles the import of a single Vault page during batch execution.
 *
 * This service allows dependency injection and encapsulates the logic
 * for processing an individual Vault page in a Drupal batch operation.
 */
class VaultPageBatchHandler {

  /**
   * The Vault API client service.
   *
   * @var \Drupal\vault_migration\VaultClient
   */
  protected VaultClient $client;

  /**
   * The Vault content importer service.
   *
   * @var \Drupal\vault_migration\ContentImporter
   */
  protected ContentImporter $importer;

  /**
   * Constructs a new VaultPageBatchHandler instance.
   *
   * @param \Drupal\vault_migration\VaultClient $client
   *   The Vault API client.
   * @param \Drupal\vault_migration\ContentImporter $importer
   *   The content importer service.
   */
  public function __construct(VaultClient $client, ContentImporter $importer) {
    $this->client = $client;
    $this->importer = $importer;
  }

  /**
   * Runs the import of a single Vault page as part of a batch operation.
   *
   * @param string $page_id
   *   The ID of the Vault page to import.
   * @param array $entry
   *   The Vault to Drupal mapping configuration.
   * @param string $database_id
   *   The ID of the Vault database the page belongs to.
   * @param array $context
   *   The batch context array (by reference).
   */
  public function run(string $page_id, array $entry, string $database_id, array &$context): void {
    if (!isset($context['results']['published_ids'])) {
      $context['results']['published_ids'] = [];
    }

    try {
      $page = $this->client->getPage($page_id);

      $this->importer->processSinglePage($page, $entry, $database_id, $context['results']['published_ids']);

      $title = $this->client->extractPlainText($page['properties']['Títol'] ?? []);
      $context['message'] = t('Processed Vault page "@title"', ['@title' => $title]);

    }
    catch (\Throwable $e) {
      $this->logger->error('Error processing page @id: @msg', [
        '@id' => $page_id,
        '@msg' => $e->getMessage(),
      ]);
      $context['results'][] = 'Error: ' . $e->getMessage();
    }
  }

}
