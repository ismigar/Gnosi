<?php


namespace Drupal\notion_bridge\Plugin\QueueWorker;

use Drupal\Core\Queue\QueueWorkerBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\notion_bridge\MappingStorage;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Processes queued Notion mentions to convert placeholders into links.
 *
 * @QueueWorker(
 *   id = "notion_bridge_mentions",
 *   title = @Translation("Notion Bridge: Resolve pending mentions"),
 *   cron = {"time" = 60}
 * )
 */
final class MentionResolverQueueWorker extends QueueWorkerBase
{
  use StringTranslationTrait;

  /** @var \Drupal\Core\Entity\EntityTypeManagerInterface */
  protected $entityTypeManager;
  /** @var \Drupal\notion_bridge\MappingStorage */
  protected $mappingStorage;
  /** @var \Psr\Log\LoggerInterface */
  protected $logger;

  public function __construct()
  {
    // Light service locator pattern because QueueWorkerBase isn't container-aware by default.
    $container = \Drupal::getContainer();
    $this->entityTypeManager = $container->get('entity_type.manager');
    $this->mappingStorage = $container->get('notion_bridge.mapping_storage');
    $this->logger = $container->get('logger.channel.notion_bridge');
  }

  /**
   * {@inheritdoc}
   */
  public function processItem($data)
  {
    // Expected $data: nid, langcode, notion_id, attempts, queued.
    $nid = (int)($data['nid'] ?? 0);
    $langcode = (string)($data['langcode'] ?? '');
    $notionId = (string)($data['notion_id'] ?? '');

    if (!$nid || $notionId === '') {
      return; // Ignore malformed items.
    }

    /** @var \Drupal\node\NodeInterface|null $node */
    $node = $this->entityTypeManager->getStorage('node')->load($nid);
    if (!$node || !$node->hasField('body')) {
      return; // Node deleted or not eligible.
    }

    $body = (string)($node->get('body')->value ?? '');
    if ($body === '' || strpos($body, 'data-notion-id') === false) {
      return; // Nothing to do.
    }

    // Try to resolve to alias.
    $alias = '';
    if ($mappedNid = $this->mappingStorage->getNodeIdByNotionId($notionId)) {
      $alias = \Drupal::service('path_alias.manager')->getAliasByPath('/node/' . $mappedNid, $langcode ?: NULL);
    }

    if ($alias) {
      $pattern = '/<span\s+data-notion-id="' . preg_quote($notionId, '/') . '">(.*?)<\/span>/is';
      $replacement = '<a href="' . htmlspecialchars($alias, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">$1</a>';
      $newBody = preg_replace($pattern, $replacement, $body, -1, $count);

      if ($count > 0 && $newBody !== null && $newBody !== $body) {
        $node->set('body', [
          'value' => $newBody,
          'format' => $node->get('body')->format ?? 'full_html',
        ]);
        $node->save();
        $this->logger->notice('Resolved @count mention(s) for node @nid (Notion @id).', ['@count' => $count, '@nid' => $nid, '@id' => $notionId]);
      }
      return; // Done.
    }

    // If still unresolved, re-queue with backoff (handled by cron scheduling policy outside).
    // We do nothing here; letting the item fail will cause it to be retried on next cron if using ReliableQueue.
  }
}
