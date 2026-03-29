<?php

declare(strict_types=1);

namespace Drupal\notion_bridge;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\file\Entity\File;
use Drupal\file\FileInterface;
use Drupal\file\FileUsage\FileUsageInterface;
use Psr\Log\LoggerInterface;

/**
 * Service to clean unused file entities created by Notion Bridge.
 */
class Cleaner {

  /**
   * The entity type manager service.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The logger service for notion_bridge.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * File usage tracking service.
   *
   * @var \Drupal\file\FileUsage\FileUsageInterface
   */
  protected FileUsageInterface $fileUsage;

  /**
   * Constructs the NotionBridgeCleaner service.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager service.
   * @param \Drupal\Core\Logger\LoggerChannelFactoryInterface $loggerFactory
   *   The logger channel factory.
   * @param \Drupal\file\FileUsage\FileUsageInterface $fileUsage
   *   File usage tracking service.
   */
  public function __construct(
    EntityTypeManagerInterface $entityTypeManager,
    LoggerChannelFactoryInterface $loggerFactory,
    FileUsageInterface $fileUsage
  ) {
    $this->entityTypeManager = $entityTypeManager;
    $this->logger = $loggerFactory->get('notion_bridge');
    $this->fileUsage = $fileUsage;
  }

  /**
   * Deletes file entities marked as permanent but unused.
   *
   * A file is considered unused if it has no usage references.
   */
  public function cleanUnusedFiles(): void {
    // Query permanent files.
    $fids = \Drupal::entityQuery('file')
      ->accessCheck(FALSE)
      ->condition('status', FileInterface::STATUS_PERMANENT)
      ->execute();

    if (!$fids) {
      $this->logger->notice('✅ File cleanup completed. Total files deleted: 0');
      return;
    }

    $storage = $this->entityTypeManager->getStorage('file');
    /** @var \Drupal\file\FileInterface[] $files */
    $files = $storage->loadMultiple($fids);
    $deleted = 0;

    foreach ($files as $file) {
      if ($file instanceof File && $file->getFileUri()) {
        // Check if the file is referenced anywhere.
        $usage = $this->fileUsage->listUsage($file);
        if (empty($usage)) {
          $file->delete();
          $deleted++;
        }
      }
    }

    $this->logger->notice('✅ File cleanup completed. Total files deleted: @count', [
      '@count' => $deleted,
    ]);
  }

  /**
   * Hook cron proxy to trigger file cleanup periodically.
   */
  public function onCron(): void {
    $this->cleanUnusedFiles();
  }

}
