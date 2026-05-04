<?php

namespace Drupal\remove_unused_files\Commands;

use Drupal\remove_unused_files\RemoveUnusedFilesService;
use Drush\Commands\DrushCommands;

/**
 * Remove unused files commands.
 */
final class RemoveUnusedFilesCommands extends DrushCommands {

  /**
   * Drush command constructor.
   */
  public function __construct(private RemoveUnusedFilesService $removeUnusedFiles) {}

  /**
   * Adding flags to remove unused files for in next cron run.
   *
   * @command remove_unused_files
   * @usage remove_unused_files
   */
  public function removeUnusedFiles() {
    $result = $this->removeUnusedFiles->exec();
    $this->logger()->log($result->logLevelDrush, \dt($result->messageString));
  }

}
