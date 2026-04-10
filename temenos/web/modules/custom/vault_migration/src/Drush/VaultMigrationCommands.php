<?php

namespace Drupal\vault_migration\Drush;

use Drush\Attributes as CLI;
use Drush\Commands\DrushCommands;
use Symfony\Component\Console\Style\SymfonyStyle;
use Drupal\vault_migration\VaultMigrationSyncManager;
use Drupal\vault_migration\Cleaner;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\Datetime\DateFormatterInterface;

/**
 * Drush commands for the Vault Bridge module.
 *
 * Provides CLI utilities for syncing and cleaning Vault content in Drupal.
 */
final class VaultMigrationCommands extends DrushCommands {

  /**
   * Service to clean unused or orphaned files.
   *
   * @var \Drupal\vault_migration\Cleaner
   */
  protected Cleaner $cleaner;

  /**
   * Sync manager to pull Vault content into Drupal (nodes + translations).
   *
   * @var \Drupal\vault_migration\VaultMigrationSyncManager
   */
  protected VaultMigrationSyncManager $syncManager;

  /**
   * State API service to store last sync timestamps.
   *
   * @var \Drupal\Core\State\StateInterface
   */
  protected StateInterface $state;

  /**
   * Service for formatting dates.
   *
   * @var \Drupal\Core\Datetime\DateFormatterInterface
   */
  protected DateFormatterInterface $dateFormatter;

  /**
   * Config factory to read module settings.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $configFactory;

  /**
   * Lock backend to prevent concurrent syncs per bundle.
   *
   * @var \Drupal\Core\Lock\LockBackendInterface
   */
  protected LockBackendInterface $lock;

  /**
   * Constructs the VaultMigrationCommands class.
   *
   * @param \Drupal\vault_migration\Cleaner $cleaner
   *   Service to clean orphaned file entities.
   * @param \Drupal\vault_migration\VaultMigrationSyncManager $sync_manager
   *   Sync manager to pull Vault content into Drupal (nodes + translations).
   * @param \Drupal\Core\State\StateInterface $state
   *   State service to store last sync timestamps per bundle.
   * @param \Drupal\Core\Datetime\DateFormatterInterface $dateFormatter
   *   Service for formatting timestamps.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   Config factory to read module settings.
   * @param \Drupal\Core\Lock\LockBackendInterface $lock
   *   Lock backend to prevent concurrent syncs per bundle.
   */
  public function __construct(
    Cleaner $cleaner,
    VaultMigrationSyncManager $sync_manager,
    StateInterface $state,
    DateFormatterInterface $dateFormatter,
    ConfigFactoryInterface $configFactory,
    LockBackendInterface $lock
  ) {
    $this->cleaner = $cleaner;
    $this->syncManager = $sync_manager;
    $this->state = $state;
    $this->dateFormatter = $dateFormatter;
    $this->configFactory = $configFactory;
    $this->lock = $lock;
  }

  /**
   * Shows the current sync status for each tracked Vault database.
   *
   * @command vault-migration:status
   * @aliases nb-status
   */
  #[CLI\Command(
    name: 'vault-migration:status',
    aliases: ['nb-status'])]
  #[CLI\Help(
    description: 'Shows the current sync status for each tracked Vault database.'
  )]
  public function status(): void {
    $io = new SymfonyStyle($this->input(), $this->output());

    $cfg = $this->configFactory->get('vault_migration.settings');
    $dbMap = (array) ($cfg->get('databases') ?? []);

    if (empty($dbMap)) {
      $io->warning('No bundles configured under vault_migration.settings:databases.');
      return;
    }

    $io->title('Vault Bridge Status');
    foreach ($dbMap as $bundle => $dbId) {
      $ts = (int) $this->state->get("vault_migration.last_sync.$bundle", 0);
      $date = $ts ? $this->dateFormatter->format($ts, 'short') : 'Never';
      $io->writeln("• $bundle ($dbId) → $date");
    }
  }

  /**
   * Synchronizes Vault → Drupal for one bundle or all configured bundles.
   *
   * If a bundle is provided, syncs only that one. Otherwise, syncs all
   * bundles configured under vault_migration.settings:databases.
   * If `--full` is passed, the command ignores last-sync timestamps.
   *
   * @param string|null $bundle
   *   Optional Drupal bundle machine name (e.g., 'article').
   * @param array $options
   *   Options array (e.g., ['full' => TRUE]).
   *
   * @command vault-migration:sync
   * @aliases nb-sync
   * @option full Force full synchronization (ignore last sync timestamp).
   */
  #[CLI\Command(name: 'vault-migration:sync', aliases: ['nb-sync'])]
  #[CLI\Help(description: 'Sync Vault databases into Drupal for one bundle or all configured bundles.')]
  #[CLI\Option(name: 'full', description: 'Force full synchronization (ignore last sync timestamp).')]
  public function sync(?string $bundle = NULL, array $options = ['full' => false]): void {
    $io = new SymfonyStyle($this->input(), $this->output());
    $isFull = (bool) ($options['full'] ?? false);

    $cfg = $this->configFactory->get('vault_migration.settings');
    $dbMap = (array) ($cfg->get('databases') ?? []);

    $bundles = [];
    if ($bundle) {
      if (!isset($dbMap[$bundle])) {
        $io->error("Bundle '$bundle' is not configured under vault_migration.settings:databases.");
        return;
      }
      $bundles = [$bundle];
    }
    else {
      $bundles = array_keys($dbMap);
    }

    if (empty($bundles)) {
      $io->warning('No bundles to sync. Configure databases under vault_migration.settings:databases.');
      return;
    }

    foreach ($bundles as $b) {
      $label = $dbMap[$b] ?? '';
      $io->section("→ $b" . ($label ? " ($label)" : ''));

      $lockName = "vault_migration.sync.$b";
      if (!$this->lock->acquire($lockName, 600)) {
        $io->warning("Another sync seems to be running for bundle '$b'. Skipping.");
        continue;
      }

      try {
        // If you later implement incremental syncs, you can read last-sync
        // here and pass it down. For now, the SyncManager runs a full pass.
        $this->syncManager->sync($b);
        $this->state->set("vault_migration.last_sync.$b", time());
        $io->success("Bundle '$b' synced.");
      }
      catch (\Throwable $e) {
        $io->error("Sync failed for bundle '$b': " . $e->getMessage());
      }
      finally {
        $this->lock->release($lockName);
      }
    }

    // Optional cleanup if requested.
    if ($isFull) {
      $io->note('Performing cleanup of unused files …');
      $this->cleaner->cleanUnusedFiles();
    }

    $io->success('Synchronization finished.');
  }

  /**
   * Manually triggers cleanup of unused file entities.
   *
   * @command vault-migration:cleanOrphans
   * @aliases nb-clean
   */
  #[CLI\Command(
    name: 'vault-migration:cleanOrphans',
    aliases: ['nb-clean']
  )]
  #[CLI\Help(
    description: 'Clean orphaned files.'
  )]
  public function cleanOrphans(): void {
    $this->cleaner->cleanUnusedFiles();
  }
}
