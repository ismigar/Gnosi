<?php

namespace Drupal\notion_bridge\Cron;

use Drupal\notion_bridge\ContentImporter;
use Drupal\notion_bridge\ConfigManager;
use Drupal\notion_bridge\Cleaner;
use Psr\Log\LoggerInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Component\Datetime\TimeInterface;

/**
 * Scheduled task that synchronizes Notion databases with Drupal nodes.
 *
 * This service runs automatically during Drupal's cron execution.
 * It performs:
 *  - A full sync once per day at a configured hour (default: 23h), which includes file cleanup.
 *  - Incremental syncs during the rest of the day using timestamps.
 */
class NotionBridgeCron {

  /**
   * Service for importing Notion content into Drupal.
   *
   * @var \Drupal\notion_bridge\ContentImporter
   */
  protected ContentImporter $importer;

  /**
   * Logger for recording sync activity.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * State service to persist last sync timestamps and flags.
   *
   * @var \Drupal\Core\State\StateInterface
   */
  protected StateInterface $state;

  /**
   * Drupal config factory for accessing stored configurations.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $configFactory;

  /**
   * Time service for retrieving current timestamps.
   *
   * @var \Drupal\Component\Datetime\TimeInterface
   */
  protected TimeInterface $time;

  /**
   * Service providing access to Notion config settings (like sync hour).
   *
   * @var \Drupal\notion_bridge\ConfigManager
   */
  protected ConfigManager $configManager;

  /**
   * Service responsible for cleaning unused files from the filesystem.
   *
   * @var \Drupal\notion_bridge\Cleaner
   */
  protected Cleaner $cleaner;

  /**
   * Constructs a new NotionBridgeCron service.
   *
   * @param \Drupal\notion_bridge\ContentImporter $importer
   *   The importer service for syncing Notion to Drupal.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger channel for this module.
   * @param \Drupal\Core\State\StateInterface $state
   *   State storage to persist timestamps and flags.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   The config factory for retrieving module config.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Time service to obtain the current time.
   * @param \Drupal\notion_bridge\ConfigManager $configManager
   *   Config manager providing access to module-level settings.
   * @param \Drupal\notion_bridge\Cleaner $cleaner
   *   Service for cleaning unused file entities and disk files.
   */
  public function __construct(
    ContentImporter        $importer,
    LoggerInterface        $logger,
    StateInterface         $state,
    ConfigFactoryInterface $configFactory,
    TimeInterface          $time,
    ConfigManager          $configManager,
    Cleaner                $cleaner
  ) {
    $this->importer = $importer;
    $this->logger = $logger;
    $this->state = $state;
    $this->configFactory = $configFactory;
    $this->time = $time;
    $this->configManager = $configManager;
    $this->cleaner = $cleaner;
  }

  /**
   * Executes the Notion sync process during Drupal cron.
   *
   * Loads configured databases and performs:
   *  - Full sync at the configured hour (with file cleanup).
   *  - Incremental sync at any other time, using last sync timestamp.
   *
   * Sync status is tracked using state keys:
   *  - `notion_bridge.last_sync.[db_id]` for last timestamp
   *  - `notion_bridge.full_sync_done.[db_id]` for daily cleanup
   */
  public function run(): void {
    $now = $this->time->getCurrentTime();
    $hour = (int) date('G', $now);
    $today = date('Ymd', $now);

    $config = $this->configFactory->get('notion_bridge.settings');
    $entries = json_decode($config->get('config_json') ?: '[]', TRUE);

    foreach ($entries as $entry) {
      $database_id = $entry['id'] ?? NULL;
      if (!$database_id) {
        continue;
      }

      $database_name = $entry['name'] ?? NULL;
      $sync_key = "notion_bridge.full_sync_done.$database_id";

      if ($hour === $this->configManager->setTimeFullSync() && $this->state->get($sync_key) !== $today) {
        $this->importer->import($database_id, NULL);

        // Run file cleanup as part of full sync.
        try {
          $this->cleaner->cleanUnusedFiles();
        } catch (\Throwable $e) {
          $this->logger->error('🧹 File cleanup failed during cron: @msg', [
            '@msg' => $e->getMessage(),
          ]);
        }

        $this->state->set("notion_bridge.last_sync.$database_id", $now);
        $this->state->set($sync_key, $today);
      }
      else {
        $last_synced = (int) $this->state->get("notion_bridge.last_sync.$database_id", 0);
        $this->importer->import($database_id, $last_synced);
        $this->state->set("notion_bridge.last_sync.$database_id", $now);
      }
    }
  }

}
