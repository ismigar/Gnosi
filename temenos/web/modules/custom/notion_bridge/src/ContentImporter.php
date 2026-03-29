<?php

namespace Drupal\notion_bridge;

use Drupal\node\Entity\Node;
use Drupal\node\NodeInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityDisplayRepositoryInterface;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Http\ClientFactory;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\Core\Utility\Token;
use Drupal\file\FileRepositoryInterface;
use Drupal\file\FileUsage\FileUsageInterface;
use Drupal\pathauto\PathautoGeneratorInterface;
use Psr\Log\LoggerInterface;
use Drupal\Core\Queue\QueueFactory;
use Drupal\Core\Batch\BatchBuilder;
use Drupal\file\FileInterface;
use Drupal\taxonomy\Entity\Term;
use Drupal\field\Entity\FieldConfig;
use Drupal\Component\Serialization\Json;
use GuzzleHttp\Exception\RequestException;

/**
 * Service class that imports Notion pages into Drupal nodes.
 *
 * Handles batch importing, synchronization logic, and cleanup of outdated content.
 */
class ContentImporter {

  /**
   * Maximum number of nodes to delete in a single cleanup cycle.
   */
  private const MAX_DELETE_LIMIT = 200;
  /**
   * Allowed time drift (in seconds) when comparing last sync timestamps.
   */
  public const SYNC_TIME_DRIFT = 5;

  /**
   *  Allowed size files uploaded
   */
  private const MAX_SIZE_FILES = 10 * 1024 * 1024; // 10 MB

  /**
   * Service for interacting with the Notion API.
   *
   * @var \Drupal\notion_bridge\NotionClient
   */
  protected NotionClient $notionClient;

  /**
   * Provides access to entity storage and handlers.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * Handles storage and retrieval of Notion-to-Drupal mapping data.
   *
   * @var \Drupal\notion_bridge\MappingStorage
   */
  protected MappingStorage $mappingStorage;

  /**
     * Provides metadata about entity fields.
   *
   * @var \Drupal\Core\Entity\EntityFieldManagerInterface
   */
  protected EntityFieldManagerInterface $fieldManager;

  /**
   * File system service for managing file paths and directories.
   *
   * @var \Drupal\Core\File\FileSystemInterface
   */
  protected FileSystemInterface $fileSystem;

  /**
   * Cache backend for storing temporary data and sync states.
   *
   * @var \Drupal\Core\Cache\CacheBackendInterface
   */
  protected CacheBackendInterface $cacheBackend;

  /**
   * Token replacement service for generating dynamic paths and text.
   *
   * @var \Drupal\Core\Utility\Token
   */
  protected Token $token;

  /**
   * Configuration factory service for accessing site configuration.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $configFactory;

  /**
   * Provides access to display settings for entities and forms.
   *
   * @var \Drupal\Core\Entity\EntityDisplayRepositoryInterface
   */
  protected EntityDisplayRepositoryInterface $entityDisplayRepository;

  /**
   * Service for accessing the current request time and other time utilities.
   *
   * @var \Drupal\Component\Datetime\TimeInterface
   */
  protected TimeInterface $time;

  /**
   * Logger service for error and status reporting.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * Provides access to the string translation service.
   *
   * Used to translate interface strings to the active language.
   *
   * @var \Drupal\Core\StringTranslation\TranslationInterface
   */
  protected TranslationInterface $stringTranslation;

  /**
   * Handles file creation and management.
   *
   * Provides methods to save file contents, ensure unique filenames,
   * and interact with the file entity system.
   *
   * @var \Drupal\file\FileRepositoryInterface
   */
  protected FileRepositoryInterface $fileRepository;

  /**
   * Pathauto generator service.
   *
   * @var \Drupal\pathauto\PathautoGeneratorInterface
   */
  protected PathautoGeneratorInterface $pathautoGenerator;

  /**
   * Pages that contain unresolved mentions to other Notion pages.
   *
   * Format:
   * [
   *   'source_nid' => [
   *     'body' => '... raw HTML with unresolved mentions ...',
   *     'mentioned_ids' => ['notion_id_1', 'notion_id_2']
   *   ],
   *   ...
   * ]
   *
   * @var array
   */
  protected array $pendingMentions = [];

  /**
   * Current user session
   *
   * @var Drupal\Core\Session\AccountProxyInterface;
   */
  protected AccountProxyInterface $currentUser;

  /**
   * The node currently being imported.
   *
   * @var \Drupal\node\NodeInterface|null
   */
  protected ?NodeInterface $currentNode = null;

  /**
   * HTTP client factory (Guzzle) for downloads.
   *
   * @var \Drupal\Core\Http\ClientFactory
   */
  protected ClientFactory $httpClientFactory;

  /**
   * Files usages interface
   *
   * @var \Drupal\file\FileUsage\FileUsageInterface
   */
  protected FileUsageInterface $fileUsage;

  /**
   * MIME type guesser.
   *
   * @var
   */
  protected $mimeTypeGuesser;

  /**
   * Queue factory for enqueuing pending mentions.
   *
   * @var \Drupal\Core\Queue\QueueFactory
   */
  protected QueueFactory $queueFactory;

  /**
   * Constructs a ContentImporter object.
   *
   * @param \Drupal\notion_bridge\NotionClient $notionClient
   *   The Notion API client service.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\notion_bridge\MappingStorage $mappingStorage
   *   The mapping storage service for Notion-to-Drupal mappings.
   * @param \Drupal\Core\Entity\EntityFieldManagerInterface $fieldManager
   *   The entity field manager.
   * @param \Drupal\Core\File\FileSystemInterface $fileSystem
   *   The file system service.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cacheBackend
   *   The cache backend.
   * @param \Drupal\Core\Utility\Token $token
   *   The token service.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   The config factory.
   * @param \Drupal\Core\Entity\EntityDisplayRepositoryInterface $entityDisplayRepository
   *   The entity display repository.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The time service.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger service.
   * @param Drupal\Core\StringTranslation\StringTranslationInterface $stringTranslation
   *   The translation service.
   * @param \Drupal\file\FileRepositoryInterface $fileRepository
   *    The file repository service.
   * @param Drupal\pathauto\PathautoGeneratorInterface $pathautoGenerator
   *    The pathauto service.
   * @param Drupal\Core\Session\AccountProxyInterface $currentUser
   *    Current user session.
   * @param \Drupal\Core\Http\ClientFactory $httpClientFactory
   *    HTTP client factory.
   * @param \Drupal\file\FileUsage\FileUsageInterface $fileUsage
   *    File usage tracker.
   * @param \Drupal\Core\File\MimeType\MimeTypeGuesserInterface $mimeTypeGuesser
   *    MIME type guesser.
   * @param \Drupal\Core\Queue\QueueFactory $queueFactory
   *    Queue factory for pending mentions.
   */
  public function __construct(
    NotionClient $notionClient,
    EntityTypeManagerInterface $entityTypeManager,
    MappingStorage $mappingStorage,
    EntityFieldManagerInterface $fieldManager,
    FileSystemInterface $fileSystem,
    CacheBackendInterface $cacheBackend,
    Token $token,
    ConfigFactoryInterface $configFactory,
    EntityDisplayRepositoryInterface $entityDisplayRepository,
    TimeInterface $time,
    LoggerInterface $logger,
    TranslationInterface $stringTranslation,
    FileRepositoryInterface $fileRepository,
    PathautoGeneratorInterface $pathautoGenerator,
    AccountProxyInterface $currentUser,
    ClientFactory $httpClientFactory,
    FileUsageInterface $fileUsage,
    $mimeTypeGuesser,
    QueueFactory $queueFactory
  ) {
    $this->notionClient = $notionClient;
    $this->entityTypeManager = $entityTypeManager;
    $this->mappingStorage = $mappingStorage;
    $this->fieldManager = $fieldManager;
    $this->fileSystem = $fileSystem;
    $this->cacheBackend = $cacheBackend;
    $this->token = $token;
    $this->configFactory = $configFactory;
    $this->entityDisplayRepository = $entityDisplayRepository;
    $this->time = $time;
    $this->logger = $logger;
    $this->stringTranslation = $stringTranslation;
    $this->fileRepository = $fileRepository;
    $this->pathautoGenerator = $pathautoGenerator;
    $this->currentUser = $currentUser;
    $this->httpClientFactory = $httpClientFactory;
    $this->fileUsage = $fileUsage;
    $this->mimeTypeGuesser = $mimeTypeGuesser;
    $this->queueFactory = $queueFactory;
  }

  /**
   * Factory method for dependency injection container.
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   *
   * @return static
   *   Returns an instance of the ContentImporter service.

  /**
   * Imports a Notion database by its ID and creates or updates Drupal nodes.
   *
   * @param string $databaseId
   *  The Notio ID database.
   * @param int|null $lastSynced
   *  Timestamp of the last sincronization.
   *
   * @return void
   */
  public function import(string $databaseId, ?int $lastSynced = null): void {
    // 1. Load configured entries.
    $config = $this->configFactory->get('notion_bridge.settings');
    $entries = json_decode($config->get('config_json') ?: '[]', TRUE);

    // 2. Find matching config entry.
    $entry = $this->findEntryById($entries, $databaseId);
    if (!$entry) {
      return;
    }

    $publish_field_key = $entry['publish_property'] ?? null;

    // 3. Retrieve database metadata and publish field definition.
    $dbMeta = $this->notionClient->retrieveDatabase($databaseId);

    $propMeta = $dbMeta['properties'][$publish_field_key] ?? [];

    // 4. Build filter to only fetch published items.
    $finalFilter = $this->notionClient->buildPublishFilter($propMeta, $publish_field_key);

    // 5. Query Notion
    $publishedIds = [];
    // queryDatabaseAll() retorna un \Generator – cal convertir-ho si vols ordenar.
    $pages_iter = $this->notionClient->queryDatabaseAll($databaseId, $finalFilter);
    $pages = iterator_to_array($pages_iter, FALSE);
    usort(
      $pages,
      static function ($a, $b) {
        return strtotime($a['created_time'] ?? '1970-01-01') <=> strtotime($b['created_time'] ?? '1970-01-01');
      }
    );

    if (PHP_SAPI === 'cli') {
      foreach ($pages as $page) {
        $this->processSinglePage($page, $entry, $databaseId, $publishedIds);
      }
    } else {
      $page_ids = [];
      foreach ($pages as $page) {
        $page_ids[] = $page['id'] ?? null;
      }
      $page_ids = array_filter($page_ids);

      if (!empty($page_ids)) {
        $batch = $this->buildImportBatch($page_ids, $databaseId, $entry);
        batch_set($batch);
      }
    }

    // 6. Cleanup unpublished nodes.
    if ($lastSynced === null) {
      $this->cleanupUnpublished($publishedIds, $databaseId);
    }

    // 7. Resolve mentions només quan hem processat pàgines inline (CLI).
    // En web (batch), es farà a batchFinished().
    if (PHP_SAPI === 'cli') {
      $this->resolvePendingMentions();
    }  }

  /**
   * Marks a Notion page mention for later resolution.
   *
   * This method is called during the first import pass when a Notion page
   * contains a reference to another Notion page whose Drupal alias is not
   * yet available. It stores the raw HTML and the unresolved Notion ID
   * for post-processing.
   *
   * @param string $mentioned_id
   *   The normalized Notion page ID that was mentioned in rich text.
   */
  protected function markPendingMention(string $mentioned_id): void {
    $nid = $this->currentNode?->id();
    if (!$nid) return;

    if (!isset($this->pendingMentions[$nid])) {
      if (!$this->currentNode->hasField('body')) return;
      $this->pendingMentions[$nid] = [
        'body' => $this->currentNode->body->value,
        'mentioned_ids' => [],
      ];
    }

    $this->pendingMentions[$nid]['mentioned_ids'][] = $mentioned_id;
  }

  /**
   * Collects pending mentions from HTML and stores them for later resolution.
   *
   * @param int $nid
   *   The Drupal node ID.
   * @param string $html
   *   The HTML content to scan for <span data-notion-id="...">.
   */
  private function collectPendingMentionsFromHtml(int $nid, string $html): void {
    // Early return if $html is empty or doesn't contain data-notion-id.
    if (empty($html) || strpos($html, 'data-notion-id') === false) {
      return;
    }
    if (preg_match_all('/<span\s+data-notion-id="([^"]+)">.*?<\/span>/is', $html, $m)) {
      if (!empty($m[1])) {
        $this->pendingMentions[$nid] = [
          'body' => $html,
          'mentioned_ids' => array_values(array_unique($m[1])),
        ];
        // Enqueue each unresolved mention so cron can resolve later.
        $ids = array_values(array_unique($m[1]));
        $langcode = '';
        try {
          /** @var \Drupal\node\NodeInterface|null $n */
          $n = $this->entityTypeManager->getStorage('node')->load($nid);
          if ($n) {
            $langcode = $n->language()?->getId() ?? '';
          }
        }
        catch (\Throwable $e) {
          // Ignore lookup errors.
        }
        $queue = $this->queueFactory->get('notion_bridge_mentions');
        foreach ($ids as $id) {
          $queue->createItem([
            'nid' => $nid,
            'langcode' => $langcode,
            'notion_id' => $id,
            'attempts' => 0,
            'queued' => $this->time->getRequestTime(),
          ]);
        }
      }
    }
  }

  /**
   * Replaces pending Notion mentions with actual links in the imported nodes.
   *
   * During the first import pass, mentions to Notion pages whose aliases
   * are not yet known are stored as <span data-notion-id="...">...</span>.
   * This method resolves those spans to <a href="...">...</a> using the
   * mapping storage after all pages have been imported.
   */
  protected function resolvePendingMentions(): void {
    // Cache to avoid repeated alias lookups.
    $aliasCache = [];

    foreach ($this->pendingMentions as $nid => $data) {
      $originalBody = $data['body'];
      $updatedBody = $originalBody;
      $hasReplacements = false;

      foreach (array_unique($data['mentioned_ids']) as $notion_id) {
        // 1) Troba nid per Notion ID i després l'àlies públic de /node/{nid}.
        if (!isset($aliasCache[$notion_id])) {
          $nid = $this->mappingStorage->getNodeIdByNotionId($notion_id);
          if ($nid) {
            $aliasCache[$notion_id] = \Drupal::service('path_alias.manager')->getAliasByPath('/node/' . $nid);
          } else {
            $aliasCache[$notion_id] = '';
          }
        }

        $alias = $aliasCache[$notion_id];
        if ($alias) {
          // Patró tolerant: permet altres atributs/ordre dins el <span ...>.
          $pattern = '/<span[^>]*\\sdata-notion-id="' . preg_quote($notion_id, '/') . '"[^>]*>(.*?)<\\/span>/is';
          $replacement = '<a href="' . $alias . '">$1</a>';

          $newBody = preg_replace($pattern, $replacement, $updatedBody, -1, $count);
          if ($count > 0 && $newBody !== null) {
            $updatedBody = $newBody;
            $hasReplacements = true;
          }
        }
      }

      if ($hasReplacements && $updatedBody !== $originalBody) {
        /** @var \Drupal\node\NodeInterface|null $node */
        $node = $this->entityTypeManager->getStorage('node')->load($nid);
        if ($node && $node->hasField('body')) {
          $node->set('body', ['value' => $updatedBody, 'format' => 'full_html']);
          $node->save();
          $this->logger->notice('✅ Mentions resolved in node @nid', ['@nid' => $nid]);
        }
      }
    }
  }

// (Opcional) si vols netejar usos abans d'esborrar fitxers a cleanupUnpublished():
// $this->fileUsage->delete($file, 'notion_bridge', 'node', $node->id());
// just abans de $file->delete();

  /**
   * Builds a Drupal batch for importing Notion pages.
   *
   * Instead of passing full page data (which may include expiring URLs),
   * this version passes only page IDs, and each is reloaded at execution time.
   *
   * @param array $page_ids
   *   List of Notion page IDs to import.
   * @param string $databaseId
   *   The Notion database ID.
   * @param array $entry
   *   The sync configuration entry.
   *
   * @return array
   *   A batch definition array.
   */
  private function buildImportBatch(array $page_ids, string $databaseId, array $entry): array {
    $builder = (new \Drupal\Core\Batch\BatchBuilder())
      ->setTitle($this->t('Importing from Notion'))
      ->setInitMessage($this->t('Preparing import...'))
      ->setProgressMessage($this->t('[[@current]] / [[@total]] pages imported.'))
      ->setErrorMessage($this->t('An error occurred during import.'))
      ->setFinishCallback([static::class, 'batchFinished']);

    foreach ($page_ids as $page_id) {
      $builder->addOperation(
        [static::class, 'runImportPageBatch'],
        [$page_id, $entry, $databaseId]
      );
    }

    return $builder->toArray();
  }


  /**
   * Removes Drupal nodes that were previously synced but no longer published in Notion.
   *
   * @param array $publishedIds
   *   The list of published Notion page IDs returned in the current sync.
   * @param string $databaseId
   *   The Notion database ID.
   *
   * @result void
   */
  private function cleanupUnpublished(array $publishedIds, string $databaseId): void {
    $allMapped = array_map(
      [$this->mappingStorage, 'normalizeNotionId'],
      $this->mappingStorage->getNotionIdsByDatabase($databaseId)
    );

    $publishedIds = array_map([$this->mappingStorage, 'normalizeNotionId'], $publishedIds);
    $toDelete = array_diff($allMapped, $publishedIds);

    $totalPublished = count($publishedIds);
    $totalMapped = count($allMapped);
    $totalToDelete = count($toDelete);

    // Guardrails to avoid mass deletion due to a sync error or empty API result
    if ($totalPublished === 0 && $totalMapped > 0) {
      $this->logger->error(
        '⚠️ Sync aborted: Notion returned 0 published entries, but @n_local nodes are mapped.',
        ['@n_local' => $totalMapped]
      );
      return;
    }

    if ($totalToDelete > self::MAX_DELETE_LIMIT) {
      $this->logger->warning(
        '⚠️ Sync aborted: detected @n_delete nodes to delete (limit = @max). Check Notion status before retrying.',
        ['@n_delete' => $totalToDelete, '@max' => self::MAX_DELETE_LIMIT]
      );
      return;
    }

    foreach ($toDelete as $pageId) {
      $pageId = $this->mappingStorage->normalizeNotionId($pageId);

      if ($nid = $this->mappingStorage->getNodeIdByNotionId($pageId)) {
        if ($node = Node::load($nid)) {
          foreach ($node->getFields() as $field) {
            if (
              $field->getFieldDefinition()->getType() === 'file' ||
              $field->getFieldDefinition()->getType() === 'image'
            ) {
              foreach ($field->referencedEntities() as $file) {
                $file->delete();
              }
            }
          }
          $node->delete();
        }
        $this->mappingStorage->deleteMapping($pageId);
      }
    }
  }

  /**
   * Final batch callback: cleans up unpublished nodes.
   *
   * @param bool $success
   *   Whether the batch process completed successfully.
   * @param array $results
   *   The results returned from batch operations. Should include 'published' and optionally 'database_id'.
   * @param array $operations
   *   The list of operations that were processed. Not used in this method.
   *
   * @return void
   */
  public static function batchFinished($success, $results, $operations) {
    if (!$success) {
      \Drupal::logger('notion_bridge')->error('❌ Notion import batch failed.');
      return;
    }

    /** @var \Drupal\notion_bridge\ContentImporter $importer */
    $importer = \Drupal::service('notion_bridge.content_importer');

    // Assumim que aquests valors s'han anat guardant dins $context['results'] a les operations
    $publishedIds = $results['published_ids'] ?? [];
    $databaseId = $results['database_id'] ?? '';

    if ($publishedIds && $databaseId) {
      $importer->cleanupUnpublished($publishedIds, $databaseId);
    }

    // Once the batch is complete, we resolve any pending mentions detected.
    $importer->resolvePendingMentions();
  }

  /**
   * Batch callback to process a single Notion page with its config entry.
   *
   * @param array $page_id
   *   The Notion id page to import.
   * @param array $entry
   *   The configuration entry associated with the database (from config_json).
   * @param string $database_id
   *   The Notion database ID.
   * @param array &$context
   *   The batch context array.
   */
  public static function runImportPageBatch(string $page_id, array $entry, string $database_id, array &$context): void {
    \Drupal::service('notion_bridge.page_batch_handler')->run($page_id, $entry, $database_id, $context);
  }


  /**
   * Imports or updates a single Notion page into a Drupal node.
   *
   * @param array $item
   *   The Notion page data.
   * @param array $entry
   *   Configuration entry for this database (field mapping, node type, etc.).
   * @param string $databaseId
   *   The Notion database ID (used for mapping storage).
   * @param array &$publishedIds
   *   Reference list of page IDs that were published and processed.
   */
  public function processSinglePage(array $item, array $entry, string $databaseId, array &$publishedIds): void {
    try {
      // Normalize and re-fetch the page once at the top.
      $pageId = $this->mappingStorage->normalizeNotionId($item['id']);
      $item = $this->notionClient->getPage($pageId);

      // DEBUG segur: la propietat de fitxers a Notion és 'files' (array). No totes les pàgines la tindran.
      $debugPropKey = 'NomDelCamp';
      $filesProp = $item['properties'][$debugPropKey]['files'] ?? [];
      $firstUrl  = $filesProp[0]['file']['url'] ?? null; // només si el tipus és 'file', no 'external'
      $this->logger->debug('[DEBUG] URL (si existeix) a la propietat @key: @url', [
        '@key' => $debugPropKey,
        '@url' => $firstUrl ?? '[CAP URL]',
      ]);

      $mapping   = $entry['field_mapping'] ?? [];
      $drupalType = $entry['drupal_type'] ?? '';

      if ($drupalType === '') {
        $this->logger->error('Missing content type (drupal_type) in config entry.');
        return;
      }

      $publishFieldKey = $entry['publish_property'] ?? null;

      $lastEditedIso = $item['last_edited_time'] ?? null;
      $lastEditedTs = $lastEditedIso ? strtotime($lastEditedIso) : $this->time->getCurrentTime();

      // Respect publish flag and sync window.
      if (!$this->notionClient->isPublished($item, $publishFieldKey)) {
        return;
      }
      if (!$this->shouldSync($pageId, $databaseId, $lastEditedTs)) {
        return;
      }

      // Title / lang / created
      $titleField = $this->mappingStorage->getMappedField($mapping, 'title');
      $title   = $titleField ? $this->notionClient->extractPlainText($item['properties'][$titleField] ?? []) : 'Untitled';
      $langcode = $this->notionClient->getLangcode($item, $mapping);
      $created  = $this->notionClient->getCreatedDate($item, $mapping);

      // Render body HTML from Notion (pot fallar; millor capturar excepcions si és sensible).
      $bodyHtml = $this->notionClient->renderNotionPageAsHtml($pageId);

      $values = [
        'type'     => $drupalType,
        'title'    => $title,
        'langcode' => $langcode,
        'uid'      => 1,
        'status'   => 1,
        'created'  => $created,
        'body'     => ['value' => $bodyHtml, 'format' => 'full_html'],
      ];

      $existing_nid = $this->mappingStorage->getNodeIdByNotionId($pageId);
      $node = $existing_nid ? Node::load($existing_nid) : Node::create($values);

      $node->set('title', $title)
        ->set('langcode', $langcode)
        ->set('uid', 1)
        ->set('status', 1)
        ->set('created', $created)
        ->set('body', $values['body']);

      $this->mapFieldsToNode($node, $mapping, $item, $drupalType, $pageId);

      try {
        $node->save();
        if (!$node->id()) {
          $this->logger->warning('⚠️ Node save failed for pageId @pid', ['@pid' => $pageId]);
          return;
        }
      } catch (\Exception $e) {
        $this->logger->error('Error saving node: @msg', ['@msg' => $e->getMessage()]);
        return;
      }

      // Collect unresolved mentions (<span data-notion-id="...">) for later resolution.
      $savedBody = $node->hasField('body') ? ($node->get('body')->value ?? '') : '';
      if ($savedBody !== '') {
        $this->collectPendingMentionsFromHtml((int) $node->id(), $savedBody);
      }

      // Update pathauto alias
      $this->pathautoGenerator->updateEntityAlias($node, $existing_nid ? 'update' : 'insert', ['overwrite' => FALSE]);

      // Persist mapping
      $this->mappingStorage->saveMapping($pageId, $node->id(), $databaseId, $lastEditedTs);

      $publishedIds[] = $pageId;
    }
    catch (\Throwable $e) {
      $this->logger->error('❌ processSinglePage failed for @pid: @err', [
        '@pid' => $item['id'] ?? 'unknown',
        '@err' => $e->getMessage(),
      ]);
    }
  }

  /**
   * Determines whether a Notion page has been modified since the last sync.
   *
   * @param string $pageId
   *   Notion page ID.
   * @param string $databaseId
   *   Notion database ID.
   * @param int $lastEdited
   *   Timestamp of the last edit on the Notion page.
   *
   * @return bool
   *   TRUE if the page should be synced again, FALSE otherwise.
   */
  private function shouldSync(string $pageId, string $databaseId, int $lastEdited): bool {
    $lastSynced = $this->mappingStorage->getLastSyncedForPage($pageId, $databaseId);
    $drift = self::SYNC_TIME_DRIFT;
    return !$lastSynced || $lastEdited > ($lastSynced + $drift);
  }

  /**
   * Maps Notion properties to corresponding Drupal node fields.
   *
   * @param \Drupal\node\Entity\Node $node
   *   The Drupal node to populate.
   * @param array $mapping
   *   Array of Notion property => Drupal field mappings.
   * @param array $item
   *   The Notion page properties array.
   * @param string $drupalType
   *   The Drupal content type.
   */
  private function mapFieldsToNode(Node $node, array $mapping, array $item, string $drupalType, string $pageId): void {
    foreach ($mapping as $notionField => $drupalField) {
      if (in_array($drupalField, ['title', 'langcode', 'uid', 'created'])) {
        continue;
      }

      $prop = $item['properties'][$notionField] ?? null;
      if (!$prop) continue;

      $fieldDef = $this->fieldManager->getFieldDefinitions('node', $drupalType)[$drupalField] ?? null;
      if (!$fieldDef) continue;

      $fieldType = $fieldDef->getType();

      switch ($fieldType) {
        case 'image':
        case 'file':
          if (!empty($prop['files'])) {
            if ($fieldType === 'image') {
              $this->importImages($node, $drupalField, $prop, $pageId, $notionField);
            } else {
              $this->importFiles($node, $drupalField, $prop, $pageId, $notionField);
            }
          }
          break;
        case 'text_with_summary':
        case 'text_long':
          $node->set($drupalField, [
            'value' => $this->notionClient->extractRichText($prop),
            'format' => 'full_html',
          ]);
          break;
        case 'text':
          $node->set($drupalField, $this->notionClient->extractPlainText($prop));
          break;
        case 'string':
        case 'string_long':
          $node->set($drupalField, $this->notionClient->extractPlainText($prop) ?: NULL );
          break;
        case 'email':
        case 'url':
        case 'rich_text':
        case 'title':
        case 'link':
        case 'files':
        case 'formula':
        case 'rollup':
          $value = $this->buildUrlLikeValue($node, $drupalField, $prop);
          $node->set($drupalField, $value);
        $this->logger->debug(
          'Map link: @field Notion shape=@shape => @value',
          [
            '@field' => $drupalField,
            '@shape' => is_array($prop) ? implode(',', array_slice(array_keys($prop), 0, 8)) : gettype($prop),
            '@value' => is_array($value) ? Json::encode($value) : (string) ($value ?? 'NULL'),
          ]
        );
        break;
        case 'datetime':
          if ($ts = $this->notionClient->extractDateStart($prop)) {
            $node->set($drupalField, ['value' => gmdate('Y-m-d\TH:i:s', $ts)]);
          }
          break;
        case 'list_string':
          if (!empty($prop['select']['name'])) {
            $value = $this->normalizeSelectValue($prop['select']['name'], $drupalField, $drupalType);
            if ($value !== null) {
              $node->set($drupalField, $value);
            }
          }
          break;
        case 'integer':
          if (isset($prop['number']) && is_numeric($prop['number'])) {
            $node->set($drupalField, (int)$prop['number']);
          }
          break;
        case 'float':
          if (isset($prop['number']) && is_numeric($prop['number'])) {
            $node->set($drupalField, (float)$prop['number']);
          }
          break;
        case 'entity_reference':
          $target_type = $fieldDef->getSetting('target_type');
          if ($target_type === 'taxonomy_term') {
            $tids = $this->handleTaxonomyTerms(
              $prop,
              $fieldDef->getSetting('handler_settings')['target_bundles'] ?? []
            );
            if ($tids) {
              $node->set($drupalField, array_map(fn($tid) => ['target_id' => $tid], $tids));
            }
          } elseif (in_array($target_type, ['file', 'image'])) {
            if ($fid = $this->notionClient->handleImageOrFile($prop)) {
              $alt = $prop['files'][0]['name'] ?? $node->label() ?? 'image';
              $node->set($drupalField, [
                'target_id' => $fid,
                'alt'       => $alt,
                'title'     => $alt,
              ]);
            }
          }
          break;
      }
    }
  }

  /**
   * Returns the exact value to set into $node->set($drupalField, $value)
   * from a Notion property that may contain a URL (directly or nested).
   *
   * @param NodeInterface $node
   * @param string $drupalField
   * @param mixed $prop
   * @return mixed
   */
  protected function buildUrlLikeValue(\Drupal\node\NodeInterface $node, string $drupalField, mixed $prop): mixed {
    $def = $node->getFieldDefinition($drupalField);
    if (!$def) {
      return NULL;
    }
    $storage    = $def->getFieldStorageDefinition();
    $fieldType  = $storage->getType();     // 'link', 'string', ...
    $isMultiple = $storage->isMultiple();

    $url = $this->notionClient->findFirstUrlInNotionProperty($prop);

    if ($fieldType === 'link') {
      if (!$url) {
        return $isMultiple ? [] : NULL;
      }
      $title = $this->notionClient->extractPlainText($prop);
      $title = is_string($title) && trim($title) !== '' ? trim($title) : ($node->label() ?: $url);
      $item  = ['uri' => $url, 'title' => $title];
      return $isMultiple ? [$item] : $item;
    }
    $this->logger->debug("Url: @url", ['@url' => $url]);
    return $url ?: NULL;
  }

  /**
   * Finds a config entry by Notion database ID.
   *
   * @param array $entries
   *   List of configured database entries.
   * @param string $id
   *   The Notion database ID to search for.
   *
   * @return array|null
   *   The matching entry or NULL if not found.
   */
  private function findEntryById(array $entries, string $id): ?array {
    $id = $this->mappingStorage->normalizeNotionId($id);
    foreach ($entries as $entry) {
      if (strcasecmp($this->mappingStorage->normalizeNotionId($entry['id']), $id) === 0) {
        return $entry;
      }
    }
    return null;
  }

  /**
   * Ensures a given Notion select value exists in a list_string field.
   *
   * @param string $notionLabel
   *   Human-readable value from Notion.
   * @param string $drupalField
   *   Drupal field machine name.
   * @param string $drupalType
   *   Drupal content type.
   *
   * @return string|null
   *   The normalized machine key or NULL if the field does not exist.
   */
  protected function normalizeSelectValue(string $notionLabel, string $drupalField, string $drupalType): ?string {
    $machineKey = mb_strtolower(trim($notionLabel), 'UTF-8');
    $machineKey = preg_replace('/[^a-z0-9_]+/', '_', $machineKey);

    $fieldDefs = $this->fieldManager->getFieldDefinitions('node', $drupalType);
    if (!isset($fieldDefs[$drupalField])) {
      return null;
    }

    $fieldConfig = $fieldDefs[$drupalField];
    $settings = $fieldConfig->getSettings();
    $allowedValues = $settings['allowed_values'] ?? [];

    // If the value already exists, return it.
    if (array_key_exists($machineKey, $allowedValues)) {
      return $machineKey;
    }

    // Add the new value to the list.
    $allowedValues[$machineKey] = $notionLabel;

    /** @var \Drupal\field\Entity\FieldConfig|null $fieldStorage */
    $fieldStorage = FieldConfig::load("node.$drupalType.$drupalField");

    if (!$fieldStorage instanceof FieldConfig) {
      $this->logger->warning('⚠️ Field config not found for field @field in type @type.', [
        '@field' => $drupalField,
        '@type' => $drupalType,
      ]);
      return null;
    }

    if ($fieldStorage instanceof FieldConfig) {
      $fieldStorage->setSetting('allowed_values', $allowedValues);
      $fieldStorage->save();
    }

    return $machineKey;
  }

  /**
   * Logs Notion API query exceptions with contextual details.
   *
   * @param \Exception $e
   *   The exception thrown by the API call.
   * @param string $dbName
   *   Human-readable Notion database name.
   */
  private function logQueryException(\Exception $e, string $dbName): void {
    $code = $e->getCode() ?: 'n/a';
    $detail = $e->getMessage();

    if ($e instanceof RequestException && $e->hasResponse()) {
      $body = (string)$e->getResponse()->getBody();
      $decoded = Json::decode($body);
      $detail = $decoded['message'] ?? $body;
    }

    $this->logger->error(
      'Error querying DB "@name": code=@code ‒ @detail',
      [
        '@name' => $dbName,
        '@code' => $code,
        '@detail' => $detail,
      ]
    );
  }

  /**
   * Handles taxonomy term creation or reuse for multi-select or select fields.
   *
   * @param array $prop
   *   The Notion property array.
   * @param array $allowed_vocabularies
   *   List of allowed vocabularies for this Drupal field.
   *
   * @return array
   *   Array of taxonomy term IDs.
   */
  protected function handleTaxonomyTerms(array $prop, array $allowed_vocabularies): array {
    $tids = [];
    $tag_items = !empty($prop['multi_select']) ? $prop['multi_select'] :
      (!empty($prop['select']['name']) ? [['name' => $prop['select']['name']]] : []);

    foreach ($tag_items as $item) {
      $term_name = $item['name'];
      foreach ($allowed_vocabularies as $vocab) {
        $terms = $this->entityTypeManager
          ->getStorage('taxonomy_term')
          ->loadByProperties(['name' => $term_name, 'vid' => $vocab]);

        if ($term = reset($terms)) {
          $tids[] = $term->id();
        } else {
          $new_term = Term::create(['vid' => $vocab, 'name' => $term_name]);
          $new_term->save();
          $tids[] = $new_term->id();
        }
      }
    }
    return $tids;
  }

  /**
   * Imports Notion files/external links into a Drupal file field.
   **
   * @param \Drupal\node\NodeInterface $node
   *   Target node.
   * @param string $field_name
   *   File field machine name.
   * @param array $property
   *   Notion property array (expects ['files' => [...]]).
   * @param string $pageId
   *   Notion page ID (for refreshing presigned URLs).
   * @param string $notionField
   *   Notion field name to refresh.
   */
  private function importFiles(NodeInterface $node, string $field_name, array $property, string $pageId, string $notionField): void {
    if (!$node->hasField($field_name) || empty($property['files'])) {
      $this->logger->error('Field @name missing on node or Notion property is empty.', ['@name' => $field_name]);
      return;
    }

    // Get upload destination from field config.
    $definition = $node->getFieldDefinition($field_name);
    $settings = $definition->getSettings();
    $scheme = $settings['uri_scheme'] ?? 'public';
    $subdir = $settings['file_directory'] ?? '';
    $directory = $scheme . '://' . ltrim($subdir, '/');

    // Cardinality.
    $storage = $definition->getFieldStorageDefinition();
    $isMultiple = $storage->isMultiple();
    $values = $isMultiple ? $node->get($field_name)->getValue() : [];

    // Allowed extensions from field settings (kept from your original logic).
    $allowed = [];
    if (!empty($settings['file_extensions'])) {
      $allowed = preg_split('/\s+/', trim((string) $settings['file_extensions'])) ?: [];
      $allowed = array_map('strtolower', $allowed);
    }

    // Helper to refresh property if a presigned URL has expired.
    $refreshProperty = function(array $fallback) use ($pageId, $notionField): array {
      try {
        $fresh = $this->notionClient->getPage($pageId);
        return $fresh['properties'][$notionField] ?? $fallback;
      }
      catch (\Throwable $e) {
        return $fallback;
      }
    };

    $items = $property['files'];

    foreach ($items as $delta => $item) {
      $url = $filename = null;
      $expiry = null;

      if (isset($item['file']['url'])) {
        $url = $item['file']['url'];
        $expiry = $item['file']['expiry_time'] ?? null;
        $filename = $item['name'] ?? basename(parse_url($url, PHP_URL_PATH));
      }
      elseif (isset($item['external']['url'])) {
        $url = $item['external']['url'];
        $filename = $item['name'] ?? basename(parse_url($url, PHP_URL_PATH));
      }
      else {
        $this->logger->warning('File entry without valid URL for field @field.', ['@field' => $field_name]);
        continue;
      }

      // Refresh presigned URL if expired.
      if ($expiry && strtotime($expiry) <= \Drupal::time()->getRequestTime()) {
        $property = $refreshProperty($property);
        $items = $property['files'] ?? $items;
        $item = $items[$delta] ?? $item;
        $url = $item['file']['url'] ?? $item['external']['url'] ?? $url;
      }

      try {
        // Download file.
        $client = $this->httpClientFactory->fromOptions([
          'timeout' => 45,
          'allow_redirects' => true,
          'http_errors' => false,
        ]);
        $response = $client->request('GET', $url);
        $status = $response->getStatusCode();

        if ($status === 401 || $status === 403) {
          // Try one immediate refresh in case the presigned URL just expired.
          $property = $refreshProperty($property);
          $items = $property['files'] ?? $items;
          $item = $items[$delta] ?? $item;
          $url = $item['file']['url'] ?? $item['external']['url'] ?? $url;
          $response = $client->request('GET', $url);
          $status = $response->getStatusCode();
        }

        if ($status < 200 || $status >= 300) {
          $this->logger->error('HTTP error @status for @field: @url', [
            '@status' => (string) $status,
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        // Read body as string (avoid stream issues later).
        $data = (string) $response->getBody();
        if ($data === '' || strlen($data) === 0) {
          $this->logger->error('Downloaded file is empty/unreadable for @field: @url', [
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        // Detect MIME: header first, then local guessers/fallbacks.
        $mime = $response->getHeaderLine('Content-Type') ?: '';
        if ($mime === '' || strcasecmp($mime, 'application/octet-stream') === 0) {
          $mimeGuess = $this->guessMimeFromFilename((string) $filename);
          if ($mimeGuess) {
            $mime = $mimeGuess;
          }
        }

        // Normalize filename and extension.
        $filename = $this->fileSystem->basename((string) $filename) ?: 'file';
        $filename = preg_replace('/[^\w\.\-]+/u', '_', $filename) ?: 'file';
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION) ?: '');

        // If no extension, try to infer from MIME.
        if ($ext === '' && $mime) {
          $map = [
            'application/pdf' => 'pdf',
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'text/plain' => 'txt',
            'application/msword' => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'application/zip' => 'zip',
            'application/x-7z-compressed' => '7z',
            'application/x-rar-compressed' => 'rar',
            'application/json' => 'json',
            'text/markdown' => 'md',
          ];
          if (isset($map[$mime])) {
            $ext = $map[$mime];
            $filename .= '.' . $ext;
          }
        }

        // Validate allowed extensions from field config.
        if (!empty($allowed)) {
          $checkExt = $ext ?: strtolower(pathinfo($filename, PATHINFO_EXTENSION) ?: '');
          if ($checkExt === '' || !in_array($checkExt, $allowed, true)) {
            $this->logger->warning('Discarded file due to disallowed extension (@ext) on field @field. URL: @url', [
              '@ext' => $checkExt ?: '—',
              '@field' => $field_name,
              '@url' => $url,
            ]);
            continue;
          }
        }

        // Ensure destination directory.
        $this->fileSystem->prepareDirectory(
          $directory,
          FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS
        );
        $destination = rtrim($directory, '/') . '/' . $filename;

        // Create managed file entity.
        $file = $this->writeOrCreateFile($data, $destination, $filename, $mime);
        if (!$file) {
          $this->logger->error('Failed creating managed file for @field: @url', [
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        // Register usage so it won't be garbage-collected.
        $this->fileUsage->add($file, 'notion_bridge', 'node', (int) $node->id());

        /**
         * Build FileItem array so it renders on view:
         * - 'display' => 1 makes the Generic file formatter show the item.
         * - 'description' uses Notion's filename (optional).
         */
        $itemValue = [
          'target_id'  => $file->id(),
          'display'    => 1,
          'description'=> $item['name'] ?? $filename ?? '',
        ];

        if ($isMultiple) {
          $values[] = $itemValue;
        } else {
          $values = [$itemValue];
          // For single-value fields, attach the first file and stop.
          break;
        }

        $itemValue = ['target_id' => $file->id()];
        if ($isMultiple) {
          $values[] = $itemValue;
        } else {
          $values = [$itemValue];
          // For single-value fields, attach the first file and stop.
          break;
        }
      }
      catch (\Throwable $e) {
        $this->logger->error('Failed to attach file to @field: @msg', [
          '@field' => $field_name,
          '@msg' => $e->getMessage(),
        ]);
      }
    }

    $node->set($field_name, $values);
  }

  /**
   * Imports Notion files/external images into a Drupal image field.
   *
   * @param \Drupal\node\NodeInterface $node
   *   Target node.
   * @param string $field_name
   *   Image field machine name.
   * @param array $property
   *   Notion property array (expects ['files' => [...]]).
   * @param string $pageId
   *   Notion page ID (for refreshing presigned URLs).
   * @param string $notionField
   *   Notion field name to refresh.
   */
  private function importImages(NodeInterface $node, string $field_name, array $property, string $pageId, string $notionField): void {
    if (!$node->hasField($field_name) || empty($property['files'])) {
      $this->logger->error('Field @name missing on node or Notion property is empty.', ['@name' => $field_name]);
      return;
    }

    // Get upload destination from field config.
    $settings = $node->getFieldDefinition($field_name)->getSettings();
    $scheme = $settings['uri_scheme'] ?? 'public';
    $subdir = $settings['file_directory'] ?? '';
    $directory = $scheme . '://' . ltrim($subdir, '/');

    // Helper for refreshing Notion property when presigned URLs expire.
    $refreshProperty = function(array $fallback) use ($pageId, $notionField): array {
      try {
        $fresh = $this->notionClient->getPage($pageId);
        return $fresh['properties'][$notionField] ?? $fallback;
      }
      catch (\Throwable $e) {
        return $fallback;
      }
    };

    $items = $property['files'];
    $isMultiple = $node->getFieldDefinition($field_name)->getFieldStorageDefinition()->isMultiple();
    $values = $isMultiple ? $node->get($field_name)->getValue() : [];

    foreach ($items as $delta => $item) {
      $url = $filename = null;
      $expiry = null;

      if (isset($item['file']['url'])) {
        $url = $item['file']['url'];
        $expiry = $item['file']['expiry_time'] ?? null;
        $filename = $item['name'] ?? basename(parse_url($url, PHP_URL_PATH));
      }
      elseif (isset($item['external']['url'])) {
        $url = $item['external']['url'];
        $filename = $item['name'] ?? basename(parse_url($url, PHP_URL_PATH));
      }
      else {
        $this->logger->warning('Image entry without valid URL for field @field.', ['@field' => $field_name]);
        continue;
      }

      if ($expiry && strtotime($expiry) <= \Drupal::time()->getRequestTime()) {
        $property = $refreshProperty($property);
        $items = $property['files'] ?? $items;
        $item = $items[$delta] ?? $item;
        $url = $item['file']['url'] ?? $item['external']['url'] ?? $url;
      }

      try {
        $client = $this->httpClientFactory->fromOptions([
          'timeout' => 30,
          'allow_redirects' => true,
          'http_errors' => false,
        ]);
        $response = $client->request('GET', $url);
        $status = $response->getStatusCode();

        if ($status === 401 || $status === 403) {
          $property = $refreshProperty($property);
          $items = $property['files'] ?? $items;
          $item = $items[$delta] ?? $item;
          $url = $item['file']['url'] ?? $item['external']['url'] ?? $url;
          $response = $client->request('GET', $url);
          $status = $response->getStatusCode();
        }

        if ($status < 200 || $status >= 300) {
          $this->logger->error('HTTP error @status for @field: @url', [
            '@status' => (string) $status,
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        $data = (string) $response->getBody();
        if ($data === '' || strlen($data) === 0) {
          $this->logger->error('Downloaded image is empty/unreadable for @field: @url', [
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        $headerMime = $response->getHeaderLine('Content-Type') ?: '';
        $mime = null;
        if ($headerMime !== '' && strcasecmp($headerMime, 'application/octet-stream') !== 0) {
          $mime = $headerMime;
        } else {
          $mime = $this->guessMimeFromFilename($filename);
          if (!$mime) {
            $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION) ?: '');
            $fallbackMap = [
              'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
              'png' => 'image/png', 'gif' => 'image/gif',
              'webp' => 'image/webp', 'svg' => 'image/svg+xml',
              'pdf' => 'application/pdf',
            ];
            $mime = $fallbackMap[$ext] ?? null;
          }
        }

        if (!$mime) {
          $this->logger->notice('Could not detect MIME for "@file"; proceeding.', [
            '@file' => (string) $filename,
          ]);
        }

        $filename = $this->fileSystem->basename($filename) ?: 'image';
        $filename = preg_replace('/[^\w\.-]+/u', '_', $filename);
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION) ?: '');
        if ($ext === '' && $mime) {
          $mimeToExt = [
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/gif'  => 'gif',
            'image/webp' => 'webp',
            'image/svg+xml' => 'svg',
          ];
          if (isset($mimeToExt[$mime])) {
            $filename .= '.' . $mimeToExt[$mime];
          }
        }

        $this->fileSystem->prepareDirectory(
          $directory,
          FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS
        );
        $destination = $directory . '/' . $filename;

        $file = $this->writeOrCreateFile($data, $destination, $filename, $mime);
        if (!$file) {
          $this->logger->error('Failed creating managed file for @field: @url', [
            '@field' => $field_name,
            '@url' => $url,
          ]);
          continue;
        }

        $this->fileUsage->add($file, 'notion_bridge', 'node', (int) $node->id());

        $alt = $item['name'] ?? $node->label() ?? $filename;
        $itemValue = [
          'target_id' => $file->id(),
          'alt'       => $alt,
          'title'     => $alt,
        ];

        if ($isMultiple) {
          $values[] = $itemValue;
        } else {
          $values = [$itemValue];
          break;
        }
      }
      catch (\Throwable $e) {
        $this->logger->error('Failed to attach image to @field: @msg', [
          '@field' => $field_name,
          '@msg' => $e->getMessage(),
        ]);
      }
    }

    $node->set($field_name, $values);
  }

  /**
   * @param string $filename
   *   File name
   *
   * @return string|null
   *    MIME type or null
   */
  private function guessMimeFromFilename(string $filename): ?string {
    $g = $this->mimeTypeGuesser;
    if (is_object($g)) {
      if (method_exists($g, 'guess')) {
        // Core (Drupal\Core\File\MimeType\MimeTypeGuesser)
        return $g->guess($filename) ?: null;
      }
      if (method_exists($g, 'guessMimeType')) {
        // Algunes implementacions del mòdul file
        return $g->guessMimeType($filename) ?: null;
      }
    }
    return null;
  }

  /**
   * Writes file contents to disk (managed file). Returns null on failure.
   *
   * @param string $content
   *   Binary file contents.
   * @param string $uri
   *   Destination URI (e.g. public://notion_files/foo.pdf).
   * @param string $filename
   *   File name for the entity.
   * @param string|null $mime
   *   Optional MIME type to set on the file.
   *
   * @return \Drupal\file\FileInterface|null
   *   Managed file entity or NULL on failure.
   */
  protected function writeOrCreateFile(string $content, string $uri, string $filename, ?string $mime = null): ?FileInterface {
    if ($content === '') {
      $this->logger->error('⚠️ writeOrCreateFile: empty content for @uri', ['@uri' => $uri]);
      return null;
    }

    try {
      $file = $this->fileRepository->writeData($content, $uri, FileSystemInterface::EXISTS_RENAME);

      if ($mime) {
        $file->setMimeType($mime);
      }
      if ($filename !== '') {
        $file->setFilename($filename);
      }

      // Opcional: si vols assignar propietari explícit:
      if ($this->currentUser && $this->currentUser->id()) {
         $file->setOwnerId((int) $this->currentUser->id());
      }

      $file->setPermanent();
      $file->save();
      return $file;
    }
    catch (\Throwable $e) {
      $this->logger->error('❌ writeData failed for @uri: @msg', [
        '@uri' => $uri,
        '@msg' => $e->getMessage(),
      ]);
      return null;
    }
  }

  /**
   * Normalizes content into a string if possible.
   *
   * @param mixed $content
   *   The content to normalize. Can be a string, a resource, or a StreamInterface.
   *
   * @return string|null
   *   The normalized string content, or NULL if invalid.
   */
  protected function normalizeContent(mixed $content): ?string {
    // 1) PSR-7 stream
    if ($content instanceof \Psr\Http\Message\StreamInterface) {
      if ($content->isSeekable()) {
        $content->rewind();
      }
      $data = (string) $content->getContents();
      $this->logger->debug('normalizeContent: stream → string de ' . strlen($data) . ' bytes');
      return $data !== '' ? $data : null;
    }

    // 2) PHP resource
    if (is_resource($content)) {
      @rewind($content);
      $data = stream_get_contents($content);
      $this->logger->debug('normalizeContent: resource → string de ' . strlen((string) $data) . ' bytes');
      return $data !== false && $data !== '' ? $data : null;
    }

    // 3) Raw string
    if (is_string($content)) {
      $this->logger->debug('normalizeContent: ja és string de ' . strlen($content) . ' bytes');
      return $content !== '' ? $content : null;
    }

    $this->logger->debug('normalizeContent: contingut nul o invàlid');
    return null;
  }

  /**
   * Builds the destination file path, sanitized filename, and MIME type.
   *
   * @param string $suggestedName
   *   Suggested file name.
   * @param string $subdir
   *   Subdirectory within public:// (can be empty).
   *
   * @return array
   *   Array containing:
   *   - string: Full URI where the file will be written.
   *   - string: Sanitized filename.
   *   - string: MIME type.
   */
  protected function buildDestination(string $suggestedName, string $subdir): array {
    // Clean the name
    $name = \Drupal\Component\Transliteration\Transliteration::create()
      ->transliterate($suggestedName, 'en');
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?: 'file';

    // Guess MIME type from the filename extension (not from the subdirectory!)
    $ext  = pathinfo($name, PATHINFO_EXTENSION);
    $map = [
      'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
      'png' => 'image/png',  'gif'  => 'image/gif',
      'webp'=> 'image/webp', 'pdf'  => 'application/pdf',
    ];
    $mime = $map[strtolower($ext)] ?? 'application/octet-stream';

    /** @var \Drupal\Core\File\FileSystemInterface $fs */
    $fs = \Drupal::service('file_system');

    // Prefix the subdirectory if it exists
    $directory = 'public://';
    if ($subdir !== '') {
      $subdir = trim($subdir, "/");
      $directory .= $subdir . '/';
    }

    // Ensure directory exists and filename is unique
    $fs->prepareDirectory($directory,
      FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS
    );
    $destination = $fs->createFilename($name, $directory); // Example: public://images/foo.png

    // Return [Full URI to write, sanitized filename, mime]
    return [$destination, basename($destination), $mime];
  }

  /**
   * Finds a duplicate file by its SHA-256 hash.
   *
   * @param string $data
   *   The file contents.
   *
   * @return \Drupal\file\FileInterface|null
   *   The matching file entity if found, NULL otherwise.
   */
  protected function findDuplicateByHash(string $data): ?\Drupal\file\FileInterface {
    $hash = hash('sha256', $data);
    // You can store the hash as metadata (file->set('field_hash', ...))
    // or search by URI if you had a consistent naming/prefixing convention.
    $ids = \Drupal::entityQuery('file')
      ->condition('field_sha256', $hash)
      ->range(0, 1)
      ->execute();

    if ($ids) {
      return \Drupal\file\Entity\File::load(reset($ids));
    }
    return null;
  }

  /**
   * Validates the size and MIME type of a file against a field's configuration.
   *
   * @param string $content
   *   File contents.
   * @param string $mime
   *   Detected MIME type.
   * @param string $entity_type
   *   Entity type to check (e.g., 'node').
   * @param string $bundle
   *   Bundle to check (e.g., 'article').
   * @param string $field_name
   *   Field machine name to validate against.
   *
   * @return bool
   *   TRUE if valid, otherwise an exception is thrown.
   *
   * @throws \RuntimeException
   *   When the file is too large, field is missing, no MIME types are configured,
   *   or the MIME type is blocked.
   */
  protected function validateSizeAndMimeType(string $content, string $mime, string $entity_type, string $bundle, string $field_name): bool {
    // Size validation
    if (strlen($content) > self::MAX_SIZE_FILES) {
      throw new \RuntimeException('File too large');
    }

    // Get the field definition
    $field_definitions = \Drupal::service('entity_field.manager')
      ->getFieldDefinitions($entity_type, $bundle);

    if (!isset($field_definitions[$field_name])) {
      throw new \RuntimeException("Field $field_name not found on $entity_type:$bundle");
    }

    $settings = $field_definitions[$field_name]->getSettings();

    // First check 'file_extensions'
    if (!empty($settings['file_extensions'])) {
      $extensions = preg_split('/\s+/', trim($settings['file_extensions']));
      $allowed_mimes = [];
      $guesser = \Drupal::service('file.mime_type.guesser');
      foreach ($extensions as $ext) {
        $mime = $guesser->guessMimeType("temporary://fake.$ext");
        if ($mime) {
          $allowed_mimes[] = $mime;
        }
      }
      $allowed_mimes = array_unique($allowed_mimes);
    }
    // Or check 'allowed_mime_types'
    elseif (!empty($settings['allowed_mime_types'])) {
      $allowed_mimes = $settings['allowed_mime_types'];
    }
    else {
      throw new \RuntimeException("No allowed MIME types configured for $field_name");
    }

    // MIME type validation
    if ($mime && !in_array($mime, $allowed_mimes, true)) {
      throw new \RuntimeException("Blocked MIME: $mime");
    }

    return true;
  }

  /**
   * Prepares a list of batch operations to import all pages from a Notion database.
   *
   * @param string $database_id
   *   The ID of the Notion database to process. Must not be empty.
   * @param int|null $last_synced
   *   Optional timestamp of the last synchronization. If provided, only pages
   *   modified after this time will be included via a Notion filter.
   *
   * @return array
   *   A list of batch operations ready to be passed to batch_set().
   *
   * @throws \InvalidArgumentException
   *   If the database ID is empty.
   * @throws \RuntimeException
   *   If the Notion request fails or yields invalid data.
   */
  public function prepareImportBatch(string $database_id, array $entry, ?int $last_synced = NULL): array {
    $operations = [];

    if (empty($database_id)) {
      throw new \InvalidArgumentException('Cannot prepare batch: database ID is empty.');
    }

    // Query the Notion database with optional filter for recently modified pages.
    $finalFilter = $this->buildFilter($last_synced);

    $page_ids = [];
    foreach ($this->notionClient->queryDatabaseAll($database_id, $finalFilter) as $page) {
      $page_ids[] = $page['id'] ?? null;
    }
    $page_ids = array_filter($page_ids);

    if (!empty($page_ids)) {
      $batch = $this->buildImportBatch($page_ids, $database_id, $entry);
      batch_set($batch);
    }

    return $operations;
  }

  /**
   * Builds a Notion API filter for pages modified after the last sync.
   *
   * @param int|null $last_synced
   *   The timestamp of the last successful synchronization.
   *
   * @return array
   *   A Notion filter array or empty array if not needed.
   */
  protected function buildFilter(?int $last_synced): array {
    if (!$last_synced) {
      return [];
    }

    return [
      'timestamp' => 'last_edited_time',
      'last_edited_time' => [
        'on_or_after' => gmdate('c', $last_synced),
      ],
    ];
  }

  /**
   * Translates a string to the current language.
   *
   * Wrapper for the string translation service.
   *
   * @param string $string
   *   A string containing the English text to translate.
   * @param array $args
   *   (optional) An associative array of replacements to make after translation.
   *   Based on the first character of the key, the value is escaped and/or themed:
   *   - @variable: Escaped to HTML using \Drupal\Component\Utility\Html::escape().
   *   - %variable: Escaped to HTML and formatted using \Drupal\Component\Render\FormattableMarkup.
   *   - !variable: Inserted as-is, with no escaping.
   * @param array $options
   *   (optional) An associative array of additional options for translation.
   *   See \Drupal\Core\StringTranslation\TranslationInterface::translate() for details.
   *
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup
   *   An object representing the translated string.
   */
  protected function t($string = '', array $args = [], array $options = []): \Drupal\Core\StringTranslation\TranslatableMarkup {
    return $string != '' ?  $this->stringTranslation->translate($string, $args, $options) : '';
  }
}
