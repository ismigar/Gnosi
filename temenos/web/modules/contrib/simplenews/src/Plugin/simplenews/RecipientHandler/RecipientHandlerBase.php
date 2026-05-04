<?php

namespace Drupal\simplenews\Plugin\simplenews\RecipientHandler;

use Drupal\Core\Plugin\PluginBase;
use Drupal\simplenews\RecipientHandler\RecipientHandlerInterface;
use Drupal\simplenews\Spool\SpoolStorageInterface;

/**
 * Base class for all Recipient Handler classes.
 */
abstract class RecipientHandlerBase extends PluginBase implements RecipientHandlerInterface {

  /**
   * The newsletter issue.
   *
   * @var \Drupal\Core\Entity\ContentEntityInterface
   */
  protected $issue;

  /**
   * The database connection.
   *
   * @var \Drupal\Core\Database\Connection
   */
  protected $connection;

  /**
   * The newsletter IDs.
   *
   * @var array
   */
  protected $newsletterIds;

  /**
   * RecipientHandlerBase constructor.
   *
   * @param array $configuration
   *   A configuration array containing information about the plugin instance.
   * @param string $plugin_id
   *   The plugin_id for the plugin instance.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->issue = $configuration['_issue'];
    $this->newsletterIds = $configuration['_newsletter_ids'];
    $this->connection = \Drupal::database();
  }

  /**
   * {@inheritdoc}
   */
  public function count(): int {
    $cache = &drupal_static(__METHOD__, []);
    $cid = $this->pluginId . ':' . implode(':', $this->newsletterIds);
    if (isset($cache[$cid])) {
      return $cache[$cid];
    }

    $count = $this->doCount();
    if ($this->cacheCount()) {
      $cache[$cid] = $count;
    }

    return $count;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm() {
    return [];
  }

  /**
   * Counts the number of recipients.
   *
   * Internal count function allowing the caller to perform caching.
   *
   * @return int
   *   Number of recipients.
   */
  abstract protected function doCount();

  /**
   * Checks if the recipient count can be cached.
   *
   * Caching is allowed if the count depends only on the newsletter IDs, and
   * does not vary with a specific issue or handler settings.
   *
   * @return bool
   *   TRUE if the count can be cached.
   */
  protected function cacheCount() {
    return FALSE;
  }

  /**
   * Returns the newsletter ID.
   *
   * @return int
   *   Newsletter ID.
   *
   * @throws \Exception
   *   The configuration doesn't specify a single newsletter ID.
   */
  protected function getNewsletterId() {
    if (count($this->newsletterIds) != 1) {
      throw new \Exception("Recipient handler requires a single newsletter ID.");
    }
    return $this->newsletterIds[0];
  }

  /**
   * Adds an array of entries to the spool.
   *
   * The caller specifies the values for a field to define the recipient.  The
   * other fields are automatically defaulted based on the issue and
   * newsletter.
   *
   * @param string $field
   *   Field to set: 'snid', 'data' (automatically serialised) or 'uid'
   *   (automatically stored in 'data' array with key 'uid').
   * @param array $values
   *   Values to set for field.
   */
  protected function addArrayToSpool($field, array $values) {
    if (empty($values)) {
      return;
    }

    $template = [
      'entity_type' => $this->issue->getEntityTypeId(),
      'entity_id' => $this->issue->id(),
      'status' => SpoolStorageInterface::STATUS_PENDING,
      'timestamp' => \Drupal::time()->getRequestTime(),
      'newsletter_id' => $this->getNewsletterId(),
    ];

    if ($field == 'uid') {
      $field = 'data';
      $values = array_map(function ($v) {
        return ['uid' => $v];
      }, $values);
    }

    $insert = $this->connection->insert('simplenews_mail_spool')
      ->fields(array_merge(array_keys($template), [$field]));

    foreach ($values as $value) {
      $row = $template;
      $row[$field] = ($field == 'data') ? serialize($value) : $value;
      $insert->values($row);
    }

    $insert->execute();
  }

}
