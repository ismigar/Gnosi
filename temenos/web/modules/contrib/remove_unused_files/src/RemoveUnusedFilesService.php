<?php

namespace Drupal\remove_unused_files;

use Drupal\Core\Database\Connection;
use Drupal\Core\Messenger\MessengerInterface;
use Psr\Log\LogLevel;

/**
 * Remove unused files service.
 */
final class RemoveUnusedFilesService {

  /**
   * The message type.
   */
  public string $messageType;

  /**
   * The log level of Psr.
   */
  public string $logLevelPsr;

  /**
   * The log level of drush.
   */
  public string $logLevelDrush;

  /**
   * The message string.
   */
  public string $messageString;

  /**
   * Service constructor.
   */
  public function __construct(protected Connection $connection) {}

  /**
   * Adding flags to remove unused files for in next cron run.
   */
  public function exec(): self {
    try {
      $this->connection->query(<<<'SQL'
      UPDATE
        {file_managed} AS b1
        , (
          SELECT
            DISTINCT {file_managed}.fid AS file_managed_fid
          FROM
            {file_managed}
          LEFT JOIN
            {file_usage} file_usage_file_managed
            ON {file_managed}.fid = {file_usage_file_managed}.fid
          GROUP BY
            {file_managed}.fid
          HAVING
            (COUNT(file_usage_file_managed.count) = 0)
        ) AS b2
      SET
        b1.status = 0
        , b1.created = 0
        , b1.changed = 0
      WHERE
        b1.fid = b2.file_managed_fid;
      SQL)->execute();
      $this->messageType = MessengerInterface::TYPE_STATUS;
      $this->logLevelPsr = LogLevel::INFO;
      $this->logLevelDrush = 'success'; /* @todo May not defined: \Drush\Log\SuccessInterface::SUCCESS */
      $this->messageString = 'Succeed of unused managed files to temporary files change. Those files removal next time cron run.';
    }
    catch (\Exception $e) {
      $this->messageType = MessengerInterface::TYPE_ERROR;
      $this->logLevelPsr = LogLevel::ERROR;
      $this->logLevelDrush = LogLevel::ERROR;
      $this->messageString = $e->getMessage();
    }
    return $this;
  }

}
