<?php

namespace Drupal\notion_bridge\Batch;

use Drupal\notion_bridge\NotionClient;
use Drupal\notion_bridge\ContentImporter;
use Psr\Log\LoggerInterface;

/**
 * Handles the import of a single Notion page during batch execution.
 *
 * This service allows dependency injection and encapsulates the logic
 * for processing an individual Notion page in a Drupal batch operation.
 */
class NotionPageBatchHandler {

  /**
   * The Notion API client service.
   *
   * @var \Drupal\notion_bridge\NotionClient
   */
  protected NotionClient $client;

  /**
   * The Notion content importer service.
   *
   * @var \Drupal\notion_bridge\ContentImporter
   */
  protected ContentImporter $importer;

  /**
   * Constructs a new NotionPageBatchHandler instance.
   *
   * @param \Drupal\notion_bridge\NotionClient $client
   *   The Notion API client.
   * @param \Drupal\notion_bridge\ContentImporter $importer
   *   The content importer service.
   */
  public function __construct(NotionClient $client, ContentImporter $importer) {
    $this->client = $client;
    $this->importer = $importer;
  }

  /**
   * Runs the import of a single Notion page as part of a batch operation.
   *
   * @param string $page_id
   *   The ID of the Notion page to import.
   * @param array $entry
   *   The Notion to Drupal mapping configuration.
   * @param string $database_id
   *   The ID of the Notion database the page belongs to.
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
      $context['message'] = t('Processed Notion page "@title"', ['@title' => $title]);

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
