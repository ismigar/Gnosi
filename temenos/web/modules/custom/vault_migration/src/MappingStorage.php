<?php
namespace Drupal\vault_migration;

use Drupal\Core\Database\Connection;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Cache\CacheBackendInterface;
use Psr\Log\LoggerInterface;

/**
 * Service to manage the mapping table between Vault pages and Drupal nodes.
 *
 * This service handles the `vault_migration_mapping` table, which links Vault page IDs
 * with Drupal node IDs, their database origin, and the timestamp of the last bridge.
 */
class MappingStorage {

  public const TABLE = 'vault_migration_mapping';

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
   * Normalizes a Vault ID by removing dashes and converting to lowercase.
   *
   * @param string $id
   *   The Vault page or database ID.
   *
   * @return string
   *   A normalized version of the ID.
   */
  public function normalizeVaultId(string $id): string {
    return strtolower(str_replace('-', '', trim($id)));
  }

  /**
   * Returns the Drupal node ID mapped to a Vault page ID.
   *
   * @param string $vault_id
   *   The Vault page ID.
   *
   * @return int|null
   *   The node ID if found, or NULL.
   */
  public function getNodeIdByVaultId(string $vault_id): ?int {
    $vault_id = $this->normalizeVaultId($vault_id);
    try {
      return $this->database->select(self::TABLE, 'm')
        ->fields('m', ['nid'])
        ->condition('vault_id', $vault_id)
        ->execute()
        ->fetchField() ?: NULL;
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getNodeIdByVaultId: @msg", ['@msg' => $e->getMessage()]);
      return null;
    }
  }

  /**
   * Returns all Vault page IDs linked to a specific Vault database.
   *
   * @param string $databaseId
   *   The Vault database ID.
   * @param bool $reset
   *   If TRUE, bypasses cache and forces DB read.
   *
   * @return array
   *   List of Vault page IDs.
   */
  public function getVaultIdsByDatabase(string $databaseId, bool $reset = FALSE): array {
    $databaseId = $this->normalizeVaultId($databaseId);
    $cid = "vault_migration:ids:$databaseId";

    try {
      if (!$reset && ($cache = $this->cache->get($cid))) {
        return $cache->data;
      }

      $query = $this->database->select(self::TABLE, 'm')
        ->fields('m', ['vault_id'])
        ->condition('database_id', $databaseId);

      $ids = $query->execute()->fetchCol() ?: [];

      $this->cache->set($cid, $ids, \Drupal::time()->getRequestTime() + 1800);
      return $ids;
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getVaultIdsByDatabase: @msg", ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Saves or updates a mapping between a Vault page and a Drupal node.
   *
   * @param string $vaultId
   *   The Vault page ID.
   * @param int $nodeId
   *   The associated Drupal node ID.
   * @param string $databaseId
   *   The Vault database ID.
   * @param int $lastEdited
   *   Timestamp of last edit in Vault.
   */
  public function saveMapping(string $vaultId, int $nodeId, string $databaseId, int $lastEditedTs): void {
    $vaultId   = $this->normalizeVaultId($vaultId);
    $databaseId = $this->normalizeVaultId($databaseId);
    $sqlDate    = date('Y-m-d H:i:s', $lastEditedTs);

    try {
      $this->database->merge(self::TABLE)
        ->key(['vault_id' => $vaultId, 'database_id' => $databaseId])
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
   * Deletes a mapping by Vault page ID.
   *
   * @param string $vault_id
   *   The Vault page ID.
   */
  public function deleteMapping(string $vault_id): void {
    $vault_id = $this->normalizeVaultId($vault_id);

    try {
      $this->database->delete(self::TABLE)
        ->condition('vault_id', $vault_id)
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
   * Returns all rows in the mapping table, indexed by Vault ID.
   *
   * @return array
   *   An associative array of mappings.
   */
  public function getAllMappings(): array {
    try {
      return $this->database->select(self::TABLE, 'm')
        ->fields('m', ['vault_id', 'nid', 'last_synced', 'database_id'])
        ->execute()
        ->fetchAllAssoc('vault_id');
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
   * Returns all Vault page IDs stored in the mapping table.
   *
   * @return array
   *   List of Vault IDs.
   */
  public function getAllVaultIds(): array {
    try {
      $result = $this->database->select(self::TABLE, 'n')
        ->fields('n', ['vault_id'])
        ->execute()
        ->fetchCol();

      return $result ?: [];
    } catch (\Exception $e) {
      $this->logger->error("❌ Error in getAllVaultIds: @msg", ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Returns the last synced timestamp for a given Vault page in a database.
   *
   * @param string $idVault
   *   The Vault page ID.
   * @param string $databaseId
   *   The Vault database ID.
   *
   * @return int|null
   *   Unix timestamp or NULL if not found.
   */
  public function getLastSyncedForPage(string $idVault, string $databaseId): ?int {
    $idVault = $this->normalizeVaultId($idVault);
    $databaseId = $this->normalizeVaultId($databaseId);

    try {
      $result = $this->database->select(self::TABLE, 'm')
        ->fields('m', ['last_synced'])
        ->condition('vault_id', $idVault)
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
