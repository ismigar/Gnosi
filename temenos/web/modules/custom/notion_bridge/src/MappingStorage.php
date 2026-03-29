<?php
namespace Drupal\notion_bridge;

use Drupal\Core\Database\Connection;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Cache\CacheBackendInterface;
use Psr\Log\LoggerInterface;

/**
 * Service to manage the mapping table between Notion pages and Drupal nodes.
 *
 * This service handles the `notion_bridge_mapping` table, which links Notion page IDs
 * with Drupal node IDs, their database origin, and the timestamp of the last bridge.
 */
class MappingStorage {

  public const TABLE = 'notion_bridge_mapping';

  protected Connection $database;
  protected DateFormatterInterface $dateFormatter;
  protected CacheBackendInterface $cache;
  protected LoggerInterface $logger;

  public function __construct(
    Connection              $database,
    DateFormatterInterface  $dateFormatter,
    CacheBackendInterface   $cache,
    LoggerInterface         $logger
  ) {
    $this->database = $database;
    $this->dateFormatter = $dateFormatter;
    $this->cache = $cache;
    $this->logger = $logger;
  }

  /**
   * Normalizes a Notion ID by removing dashes and converting to lowercase.
   *
   * @param string $id
   *   The Notion page or database ID.
   *
   * @return string
   *   A normalized version of the ID.
   */
  public function normalizeNotionId(string $id): string {
    return strtolower(str_replace('-', '', trim($id)));
  }

  /**
   * Returns the Drupal node ID mapped to a Notion page ID.
   *
   * @param string $notion_id
   *   The Notion page ID.
   *
   * @return int|null
   *   The node ID if found, or NULL.
   */
  public function getNodeIdByNotionId(string $notion_id): ?int {
    $notion_id = $this->normalizeNotionId($notion_id);
    try {
      return $this->database->select(self::TABLE, 'm')
        ->fields('m', ['nid'])
        ->condition('notion_id', $notion_id)
        ->execute()
        ->fetchField() ?: NULL;
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getNodeIdByNotionId: @msg", ['@msg' => $e->getMessage()]);
      return null;
    }
  }

  /**
   * Returns all Notion page IDs linked to a specific Notion database.
   *
   * @param string $databaseId
   *   The Notion database ID.
   * @param bool $reset
   *   If TRUE, bypasses cache and forces DB read.
   *
   * @return array
   *   List of Notion page IDs.
   */
  public function getNotionIdsByDatabase(string $databaseId, bool $reset = FALSE): array {
    $databaseId = $this->normalizeNotionId($databaseId);
    $cid = "notion_bridge:ids:$databaseId";

    try {
      if (!$reset && ($cache = $this->cache->get($cid))) {
        return $cache->data;
      }

      $query = $this->database->select(self::TABLE, 'm')
        ->fields('m', ['notion_id'])
        ->condition('database_id', $databaseId);

      $ids = $query->execute()->fetchCol() ?: [];

      $this->cache->set($cid, $ids, \Drupal::time()->getRequestTime() + 1800);
      return $ids;
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getNotionIdsByDatabase: @msg", ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Saves or updates a mapping between a Notion page and a Drupal node.
   *
   * @param string $notionId
   *   The Notion page ID.
   * @param int $nodeId
   *   The associated Drupal node ID.
   * @param string $databaseId
   *   The Notion database ID.
   * @param int $lastEdited
   *   Timestamp of last edit in Notion.
   */
  public function saveMapping(string $notionId, int $nodeId, string $databaseId, int $lastEditedTs): void {
    $notionId   = $this->normalizeNotionId($notionId);
    $databaseId = $this->normalizeNotionId($databaseId);
    $sqlDate    = date('Y-m-d H:i:s', $lastEditedTs);

    try {
      $this->database->merge(self::TABLE)
        ->key(['notion_id' => $notionId, 'database_id' => $databaseId])
        ->fields([
          'nid'          => $nodeId,
          'last_synced'  => $sqlDate,
        ])
        ->execute();
    }
    catch (\Exception $e) {
      $this->logger->error('❌ Error in saveMapping: @msg', ['@msg' => $e->getMessage()]);
    }
  }

  /**
   * Deletes a mapping by Notion page ID.
   *
   * @param string $notion_id
   *   The Notion page ID.
   */
  public function deleteMapping(string $notion_id): void {
    $notion_id = $this->normalizeNotionId($notion_id);

    try {
      $this->database->delete(self::TABLE)
        ->condition('notion_id', $notion_id)
        ->execute();
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in deleteMapping: @msg", ['@msg' => $e->getMessage()]);
    }
  }

  /**
   * Deletes all mappings associated with a given node ID.
   *
   * @param int $nid
   *   The Drupal node ID.
   */
  public function deleteByNodeId(int $nid): void {
    try {
      $this->database->delete(self::TABLE)
        ->condition('nid', $nid)
        ->execute();
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in deleteByNodeId: @msg", ['@msg' => $e->getMessage()]);
    }
  }

  /**
   * Returns all rows in the mapping table, indexed by Notion ID.
   *
   * @return array
   *   An associative array of mappings.
   */
  public function getAllMappings(): array {
    try {
      return $this->database->select(self::TABLE, 'm')
        ->fields('m', ['notion_id', 'nid', 'last_synced', 'database_id'])
        ->execute()
        ->fetchAllAssoc('notion_id');
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getAllMappings: @msg", ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Returns the key in the mapping array that matches the given target field.
   *
   * @param array $mapping
   *   The mapping array.
   * @param string $target
   *   The target field name to match.
   *
   * @return string|null
   *   The corresponding key or the target itself.
   */
  public function getMappedField(array $mapping, string $target): ?string {
    return array_search($target, $mapping, TRUE) ?: $target;
  }

  /**
   * Returns all Notion page IDs stored in the mapping table.
   *
   * @return array
   *   List of Notion IDs.
   */
  public function getAllNotionIds(): array {
    try {
      $result = $this->database->select(self::TABLE, 'n')
        ->fields('n', ['notion_id'])
        ->execute()
        ->fetchCol();

      return $result ?: [];
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getAllNotionIds: @msg", ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Returns the last synced timestamp for a given Notion page in a database.
   *
   * @param string $idNotion
   *   The Notion page ID.
   * @param string $databaseId
   *   The Notion database ID.
   *
   * @return int|null
   *   Unix timestamp or NULL if not found.
   */
  public function getLastSyncedForPage(string $idNotion, string $databaseId): ?int {
    $idNotion = $this->normalizeNotionId($idNotion);
    $databaseId = $this->normalizeNotionId($databaseId);

    try {
      $result = $this->database->select(self::TABLE, 'm')
        ->fields('m', ['last_synced'])
        ->condition('notion_id', $idNotion)
        ->condition('database_id', $databaseId)
        ->execute()
        ->fetchField();

      return $result !== false ? (int) $result : null;
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getLastSyncedForPage: @msg", ['@msg' => $e->getMessage()]);
      return null;
    }
  }
}
