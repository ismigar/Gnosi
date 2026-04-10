<?php

namespace Drupal\vault_migration;

use Drupal\Core\Config\ConfigFactoryInterface;

/**
 * Handles loading and saving Vault Bridge configuration.
 *
 * This class abstracts access to the `vault_migration.settings` config object,
 * including JSON field mapping and the cache TTL value.
 */
class ConfigManager {


  /**
   * Default cache TTL value in seconds.
   *
   * Used if no value is defined in configuration.
   */
  private const CONFIG_CACHE_CTL = 600;

  /**
   * Default max retrives.
   *
   * Used if no value is defined in configuration.
   */
  private const MAX_RETRIES = 3;

  /**
   * Default hours time to do full syncronization.
   *
   * Used if no value is defined in configuration.
   */
  private const TIME_FULL_SYNC = 23;

  /**
   * The config factory service.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $configFactory;

  /**
   * Constructs the ConfigManager.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   The configuration factory service.
   */
  public function __construct(ConfigFactoryInterface $configFactory) {
    $this->configFactory = $configFactory;
  }

  /**
   * Retrieves the decoded configuration array.
   *
   * This corresponds to the 'config_json' value stored in config.
   *
   * @return array
   *   The decoded configuration array (field mappings and database info).
   */
  public function get(): array {
    $config = $this->configFactory->get('vault_migration.settings');
    return json_decode($config->get('config_json') ?: '[]', TRUE);
  }


  /**
   * Saves the configuration array to config as JSON.
   *
   * @param array $data
   *   The array of database configuration and mappings to store.
   */
  public function save(array $data): void {
    $this->configFactory
      ->getEditable('vault_migration.settings')
      ->set('config_json', json_encode($data))
      ->save();
  }

  /**
   * Retrieves the configured cache TTL, or falls back to the default.
   *
   * @return int
   *   Cache time-to-live value in seconds.
   */
  public function getCacheTtl(): int {
    $ttl = $this->configFactory->get('vault_migration.settings')->get('cache_ttl');
    return $ttl !== null ? (int) $ttl : self::CONFIG_CACHE_CTL;
  }

  /**
   * Saves the cache TTL value to config.
   *
   * @param int $ttl
   *   The new cache TTL value in seconds.
   */
  public function setCacheTtl(int $ttl): void {
    $this->configFactory
      ->getEditable('vault_migration.settings')
      ->set('cache_ttl', $ttl)
      ->save();
  }

  /**
   * Retrieves the maximum number of retry attempts for Vault API calls.
   *
   * @return int
   *   The number of retries. Defaults to 3 if not configured.
   */
  public function getMaxRetries(): int {
    $val = $this->configFactory->get('vault_migration.settings')->get('max_retries');
    return $val !== null ? (int) $val : self::MAX_RETRIES;
  }

  /**
   * Sets the maximum number of retry attempts for Vault API calls.
   *
   * @param int $value
   *   The number of retries to allow.
   */
  public function setMaxRetries(int $value): void {
    $this->configFactory
      ->getEditable('vault_migration.settings')
      ->set('max_retries', $value)
      ->save();
  }

  /**
   * Retrieves the hours time to do full syncronization.
   *
   * @return int
   *   The hours time to do full syncronization.
   */
  public function getTimeFullSync(): int {
    $val = $this->configFactory->get('vault_migration.settings')->get('time_full_sync');
    return $val !== null ? (int) $val : self::TIME_FULL_SYNC;
  }

  /**
   * Sets the hours time to do full syncronization.
   *
   * @param int $value
   *   The hours time to do full syncronization.
   */
  public function setTimeFullSync(int $value): void {
    $this->configFactory
      ->getEditable('vault_migration.settings')
      ->set('time_full_sync', $value)
      ->save();
  }

  /**
   * Retrieves the timeout for Vault API requests in seconds.
   *
   * @return int
   *   Timeout duration in seconds. Defaults to 60 if not configured.
   */
  public function getTimeout(): int {
    $val = $this->configFactory->get('vault_migration.settings')->get('timeout');
    return $val !== null ? (int) $val : 60;
  }

  /**
   * Sets the timeout for Vault API requests.
   *
   * @param int $value
   *   Timeout duration in seconds.
   */
  public function setTimeout(int $value): void {
    $this->configFactory
      ->getEditable('vault_migration.settings')
      ->set('timeout', $value)
      ->save();
  }


}
