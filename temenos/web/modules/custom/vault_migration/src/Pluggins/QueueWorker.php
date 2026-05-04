<?php


namespace Drupal\vault_migration\Plugin\QueueWorker;

use Drupal\Core\Queue\QueueWorkerBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\vault_migration\MappingStorage;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Processes queued Vault mentions to convert placeholders into links.
 *
 * @QueueWorker(
 *   id = "vault_migration_mentions",
 *   title = @Translation("Vault Bridge: Resolve pending mentions"),
 *   cron = {"time" = 60}
 * )
 */
final class MentionResolverQueueWorker extends QueueWorkerBase
{
  use StringTranslationTrait;

  /** @var \Drupal\Core\Entity\EntityTypeManagerInterface */
  protected $entityTypeManager;
  /** @var \Drupal\vault_migration\MappingStorage */
  protected $mappingStorage;
  /** @var \Psr\Log\LoggerInterface */
  protected $logger;

  public function __construct()
  {
    // Light service locator pattern because QueueWorkerBase isn't container-aware by default.
    $container = \Drupal::getContainer();
    $this->entityTypeManager = $container->get('entity_type.manager');
    $this->mappingStorage = $container->get('vault_migration.mapping_storage');
    $this->logger = $container->get('logger.channel.vault_migration');
  }

  /**
   * {@inheritdoc}
   */
  public function processItem($data)
  {
    // Expected $data: nid, langcode, vault_id, attempts, queued.
    $nid = (int)($data['nid'] ?? 0);
    $langcode = (string)($data['langcode'] ?? '');
    $vaultId = (string)($data['vault_id'] ?? '');

    if (!$nid || $vaultId === '') {
      return; // Ignore malformed items.
    }

    /** @var \Drupal\node\NodeInterface|null $node */
    $node = $this->entityTypeManager->getStorage('node')->load($nid);
    if (!$node || !$node->hasField('body')) {
      return; // Node deleted or not eligible.
    }

    $body = (string)($node->get('body')->value ?? '');
    if ($body === '' || strpos($body, 'data-vault-id') === false) {
      return; // Nothing to do.
    }

    // Try to resolve to alias.
    $alias = '';
    if ($mappedNid = $this->mappingStorage->getNodeIdByVaultId($vaultId)) {
      $alias = \Drupal::service('path_alias.manager')->getAliasByPath('/node/' . $mappedNid, $langcode ?: NULL);
    }

    if ($alias) {
      $pattern = '/<span\s+data-vault-id="' . preg_quote($vaultId, '/') . '">(.*?)<\/span>/is';
      $replacement = '<a href="' . htmlspecialchars($alias, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">$1</a>';
      $newBody = preg_replace($pattern, $replacement, $body, -1, $count);

      if ($count > 0 && $newBody !== null && $newBody !== $body) {
        $node->set('body', [
          'value' => $newBody,
          'format' => $node->get('body')->format ?? 'full_html',
        ]);
        $node->save();
        $this->logger->notice('Resolved @count mention(s) for node @nid (Vault @id).', ['@count' => $count, '@nid' => $nid, '@id' => $vaultId]);
      }
      return; // Done.
    }

    // If still unresolved, re-queue with backoff (handled by cron scheduling policy outside).
    // We do nothing here; letting the item fail will cause it to be retried on next cron if using ReliableQueue.
  }
}
