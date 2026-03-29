<?php

declare(strict_types=1);

namespace Drupal\notion_bridge;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\KeyValueStore\KeyValueFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Component\Uuid\UuidInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Synchronizes Notion pages with Drupal nodes and their translations.
 *
 * Design goals:
 * - Use the *Formula Content Key* as the single source of truth.
 * - Generate a Content Key (UUID) only when missing, and write it back to the
 *   base property in Notion (never to rollups or formulas).
 * - Group Notion rows by content_key and upsert base node + per-language
 *   translations in an idempotent way.
 *
 * This class assumes the module exposes:
 *  - A Notion client service capable of fetching table rows and updating fields.
 *  - A MappingStorage to store additional metadata if needed (optional here).
 */
final class NotionBridgeSyncManager {

  /**
   * Tracks missing field warnings to avoid log flooding per bundle/field.
   *
   * @var array<string,array<string,bool>> [bundle => [field => TRUE]]
   */
  private array $warnedMissingFields = [];

  /**
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $etm
   *   Entity Manager to create/load nodes. (Core service)
   * @param \Drupal\Core\Language\LanguageManagerInterface $languageManager
   *   Language manager to validate available langcodes. (Core service)
   * @param \Drupal\Component\Uuid\UuidInterface $uuid
   *   UUID generator for new content keys. (Core service)
   * @param \Drupal\Core\KeyValueStore\KeyValueFactoryInterface $kvFactory
   *   KeyValue storage to map content_key <-> entity UUID. (Core service)
   * @param \Psr\Log\LoggerInterface $logger
   *   Logger channel for diagnostics.
   * @param object $notionClient
   *   The Notion client (existing service: notion_bridge.notion_client).
   *   It MUST provide methods like:
   *     - fetchRows(string $bundle): iterable<array>
   *     - queueUpdate(string $rowId, array $props): void
   *     - flush(): void
   * @param object $mappingStorage
   *   Your existing mapping storage. Kept here for future cross-checks if needed.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   To read field names configured in admin (column names in Notion).
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $etm,
    private readonly LanguageManagerInterface $languageManager,
    private readonly UuidInterface $uuid,
    private readonly KeyValueFactoryInterface $kvFactory,
    private readonly LoggerInterface $logger,
    private readonly object $notionClient,
    private readonly object $mappingStorage,
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Executes a full sync for a given bundle (node type).
   *
   * @param string $bundle
   *   Node bundle to synchronize (e.g., 'article', 'resource').
   *
   * @throws \RuntimeException
   *   When schema or API constraints are violated fatally.
   */
  public function sync(string $bundle): void {
    $cfg = $this->configFactory->get('notion_bridge.settings');

    // Column names in Notion (admin-configurable).
    $colContentKeyBase = (string) $cfg->get('columns.content_key_base') ?: 'Content_key';
    $colContentKeyFormula = (string) $cfg->get('columns.content_key_formula') ?: 'Formula Content_key';
    $colOriginalRollup = (string) $cfg->get('columns.original_content_key_rollup') ?: 'Original Content_key';
    $colLang = (string) $cfg->get('columns.lang') ?: 'idioma';
    $colStatus = (string) $cfg->get('columns.status') ?: 'estat';
    $colTitle = (string) $cfg->get('columns.title') ?: 'titol';
    $colOriginalRel = (string) ($cfg->get('columns.original_rel') ?? 'Original');
    $colIsOriginal = (string) ($cfg->get('columns.is_original_flag') ?? 'És original (auto)');
    $defaultLang = $this->languageManager->getDefaultLanguage()->getId();

    // Optional configurable batch size for periodic flushes (default: 200).
    $batchSize = (int) ($cfg->get('sync.batch_size') ?? 200);
    if ($batchSize < 1) {
      $batchSize = 200;
    }

    // Config-driven values for status mapping and optional field mappings.
    $statusPublishedValue = strtolower((string) ($cfg->get('columns.status_published_value') ?? 'Published'));
    /** @var array<string,string> $fieldMap */
    $fieldMap = (array) ($cfg->get('columns.field_map.' . $bundle) ?? []);

    $map = $this->kvFactory->get('notion_bridge.content_map');

    // 1) Fetch Notion rows and group them by ROOT page (Original relation).
    //    - rootId = first related page in $colOriginalRel, or the row's own id if empty.
    //    - For each group, if no content_key is present in any row, generate one and write it to the ROOT.
    $byRoot = [];
    $items = iterator_to_array($this->notionClient->fetchRows($bundle));

    // 0) Build parent map and canonical root resolver (handles A<->B cycles).
    $parent = []; // childId => parentId (or itself if no relation)
    $isOriginal = []; // id => bool
    $langOf = []; // id => langcode
    foreach ($items as $itRow) {
      $id = (string) ($itRow['id'] ?? '');
      if ($id === '') { continue; }
      // Track original flag and language for tie-breaking in cycles.
      $flag = $itRow[$colIsOriginal] ?? NULL;
      if ($flag === NULL && !empty($itRow['_raw_props'][$colIsOriginal]['formula']['boolean'])) {
        $flag = (bool) $itRow['_raw_props'][$colIsOriginal]['formula']['boolean'];
      }
      $isOriginal[$id] = (bool) $flag;

      $langOf[$id] = (string) ($itRow[$colLang] ?? $defaultLang);

      $relProp = $itRow[$colOriginalRel] ?? NULL;
      if (is_array($relProp) && !empty($relProp[0]) && is_string($relProp[0])) {
        $parent[$id] = $relProp[0];
      }
      elseif (is_string($relProp) && $relProp !== '') {
        $parent[$id] = $relProp;
      }
      elseif (!empty($itRow['_raw_props'][$colOriginalRel])) {
        $ids = $this->notionClient->extractRelationIds($itRow['_raw_props'][$colOriginalRel]);
        $parent[$id] = !empty($ids[0]) ? $ids[0] : $id;
      }
      else {
        $parent[$id] = $id;
      }
    }

    // Canonical root finder with path compression and preferences (flag + default lang).
    $findRoot = function(string $startId) use (&$parent, $isOriginal, $langOf, $defaultLang): string {
      $seen = [];
      $path = [];
      $id = $startId;

      while (isset($parent[$id]) && $parent[$id] !== $id) {
        if (isset($seen[$id])) {
          // Cycle detected: collect nodes in the cycle.
          $cycle = array_keys($seen);
          $cycle[] = $id;
          $cycle = array_values(array_unique($cycle));

          // 1) Prefer nodes flagged as original.
          $candidates = array_values(array_filter($cycle, fn($x) => !empty($isOriginal[$x])));
          if (!$candidates) {
            $candidates = $cycle;
          }

          // 2) Prefer default language.
          $pref = array_filter($candidates, fn($x) => ($langOf[$x] ?? '') === $defaultLang);
          if ($pref) {
            $candidates = array_values($pref);
          }

          // 3) Stable fallback: lexicographically smallest id.
          sort($candidates, SORT_STRING);
          $root = $candidates[0];

          // Path compression for all visited.
          foreach (array_keys($seen) as $n) { $parent[$n] = $root; }
          return $root;
        }
        $seen[$id] = TRUE;
        $path[] = $id;
        $id = $parent[$id] ?? $id;
      }

      $root = $id;
      foreach ($path as $n) { $parent[$n] = $root; }
      return $root;
    };

    foreach ($items as $row) {
      $rowId = (string) ($row['id'] ?? '');
      if ($rowId === '') {
        $this->logger->warning('Skipping Notion row without ID.');
        continue;
      }

      // Use canonical root (handles A<->B cycles and path compression).
      $rootId = $findRoot($rowId);

      $this->logger->debug('Row @row grouped under root @root (bundle: @bundle).', [
        '@row' => $rowId,
        '@root' => $rootId,
        '@bundle' => $bundle,
      ]);

      // Compute any existing content key in this row (prefer formula, then base, then rollup).
      $rowKey = (string) ($row[$colContentKeyFormula] ?? ($row[$colContentKeyBase] ?? ($row[$colOriginalRollup] ?? '')));

      if ($rowKey !== '') {
        $this->logger->debug('Row @row has content_key candidate: @key', ['@row' => $rowId, '@key' => $rowKey]);
      }

      // Resolve title with fallback from raw props if needed.
      $titleVal = (string) ($row[$colTitle] ?? '');
      if ($titleVal === '') {
        $titleVal = $this->extractTitleFromRaw($row['_raw_props'] ?? []);
        if ($titleVal !== '') {
          $this->logger->debug('Fallback title extracted from raw props for row @row: @title', ['@row' => $rowId, '@title' => $titleVal]);
        }
        else {
          $this->logger->warning('Empty title for row @row (bundle @bundle). Check columns.title configuration.', ['@row' => $rowId, '@bundle' => $bundle]);
        }
      }

      // Prepare a normalized projection used downstream.
      $byRoot[$rootId]['rows'][] = [
        'id' => $rowId,
        'bundle' => $bundle,
        'lang' => (string) ($row[$colLang] ?? ''),
        'status' => (string) ($row[$colStatus] ?? ''),
        'title' => $titleVal,
        '_raw' => $row,
        '_raw_props' => $row['_raw_props'] ?? [],
      ];
      if (!empty($rowKey)) {
        $byRoot[$rootId]['keys'][] = $rowKey;
      }
    }

    // 2) For each ROOT group, ensure a content_key exists (write to ROOT if needed), then upsert node + translations.
    $processed = 0;
    foreach ($byRoot as $rootId => $group) {
      $keys = array_unique(array_filter((array) ($group['keys'] ?? [])));
      $contentKey = reset($keys) ?: '';

      if ($contentKey === '') {
        // Generate a new UUID and write it back to the ROOT base property only (never to rollups/formulas).
        $contentKey = $this->uuid->generate();
        $this->logger->debug('No content_key found for root @root. Generating and writing @key to Notion.', [
          '@root' => $rootId,
          '@key' => $contentKey,
        ]);
        try {
          // Prefer a direct update for the root page so all rollups/formulas can recompute immediately.
          $this->notionClient->updatePageProperties($rootId, [$colContentKeyBase => $contentKey]);
          $this->logger->notice('Generated Content_key for root @id = @key', ['@id' => $rootId, '@key' => $contentKey]);
        }
        catch (\Throwable $e) {
          // Fallback to queueUpdate if direct update is not available in the client implementation.
          $this->logger->error('Failed to write Content_key to Notion root @id: @msg', ['@id' => $rootId, '@msg' => $e->getMessage()]);
          // $this->notionClient->queueUpdate($rootId, [$colContentKeyBase => $contentKey]);
        }
      }

      // Normalize relation "Original": clear on root, set to root on translations.
      try {
        // Root should not point to anyone.
        $this->notionClient->updatePageProperties($rootId, [
          $colOriginalRel => ['relation' => []],
        ]);

        // All other pages in the group must point to the root.
        $countNormalized = 0;
        foreach (($group['rows'] ?? []) as $r) {
          $pid = (string) ($r['id'] ?? '');
          if ($pid && $pid !== $rootId) {
            $this->notionClient->updatePageProperties($pid, [
              $colOriginalRel => ['relation' => [['id' => $rootId]]],
            ]);
            $countNormalized++;
          }
        }
        $this->logger->debug('Normalized relation "@rel": cleared on root @root; set on @count translations.', [
          '@rel' => $colOriginalRel,
          '@root' => $rootId,
          '@count' => $countNormalized,
        ]);
      }
      catch (\Throwable $e) {
        $this->logger->warning('Could not normalize relation "@rel" for root @root: @msg', [
          '@rel' => $colOriginalRel,
          '@root' => $rootId,
          '@msg' => $e->getMessage(),
        ]);
      }

      $this->upsertGroup($contentKey, $group['rows'] ?? [], $bundle, $map, $colStatus, $colTitle, $statusPublishedValue, $fieldMap);

      $this->logger->debug('Upserted group for content_key @key with @count rows (bundle: @bundle).', [
        '@key' => $contentKey,
        '@count' => count($group['rows'] ?? []),
        '@bundle' => $bundle,
      ]);

      if ($batchSize > 0 && (++$processed % $batchSize) === 0) {
        $this->notionClient->flush();
      }
    }

    // 3) Flush pending back-writes to Notion (e.g., base Content_key set).
    $this->notionClient->flush();
  }

  /**
   * Extract a title string from Notion raw properties if possible.
   *
   * @param array $rawProps
   *   The raw Notion properties array for a page.
   *
   * @return string
   *   A best-effort title string, or empty string if none.
   */
  private function extractTitleFromRaw(array $rawProps): string {
    foreach ($rawProps as $name => $prop) {
      if (!is_array($prop)) { continue; }
      if (($prop['type'] ?? '') === 'title') {
        $parts = $prop['title'] ?? [];
        $out = '';
        foreach ($parts as $part) {
          if (!empty($part['plain_text']) && is_string($part['plain_text'])) {
            $out .= $part['plain_text'];
          }
          elseif (!empty($part['text']['content'])) {
            $out .= (string) $part['text']['content'];
          }
        }
        if ($out !== '') {
          return $out;
        }
      }
    }
    return '';
  }

  /**
   * Determines the effective content key for a row, generating it if absent.
   *
   * Rules:
   *  - Prefer the *Formula Content Key*.
   *  - Fallback to base Content_key or Original Content_key rollup.
   *  - If none are present, generate a new UUID and set the base property.
   *
   * @param array $row
   * @param string $colFormula
   * @param string $colBase
   * @param string $colRollup
   *
   * @return string
   *   Guaranteed non-empty content key.
   */
  private function resolveEffectiveContentKey(
    array $row,
    string $colFormula,
    string $colBase,
    string $colRollup,
  ): string {
    $rowId = (string) ($row['id'] ?? '');
    $effective = (string) ($row[$colFormula] ?? '');

    if ($effective === '') {
      $effective = (string) ($row[$colBase] ?? ($row[$colRollup] ?? ''));
    }

    if ($effective === '') {
      // Generate a new UUID and write it back to the base property (only!).
      $effective = $this->uuid->generate();
      // Batch the update: never write to formula/rollup, only to the base column.
      $this->notionClient->queueUpdate($rowId, [$colBase => $effective]);
      $this->logger->info('Generated new content_key for Notion row @id', ['@id' => $rowId]);
    }

    return $effective;
  }

  /**
   * Creates/updates the base node and all translations for the given group.
   *
   * @param string $contentKey
   *   Effective content key.
   * @param array<int,array> $rows
   *   Rows for the same logical content key (different languages).
   * @param string $bundle
   *   Node bundle.
   * @param \Drupal\Core\KeyValueStore\KeyValueStoreInterface $map
   *   KeyValue mapping content_key => entity UUID.
   * @param string $colStatus
   *   Notion status column name.
   * @param string $colTitle
   *   Notion title column name.
   * @param string $statusPublishedValue
   *   Lowercased value in Notion that indicates a published translation.
   * @param array<string,string> $fieldMap
   *   Optional field mapping: [drupal_field_name => notion_property_name].
   */
  private function upsertGroup(
    string $contentKey,
    array $rows,
    string $bundle,
    KeyValueStoreInterface $map,
    string $colStatus,
    string $colTitle,
    string $statusPublishedValue,
    array $fieldMap = [],
  ): void {
    $storage = $this->etm->getStorage('node');
    $entityUuid = (string) ($map->get($contentKey) ?? '');
    $node = NULL;

    if ($entityUuid !== '') {
      $loaded = $storage->loadByProperties(['uuid' => $entityUuid]);
      $node = $loaded ? reset($loaded) : NULL;
      if (!$node) {
        $this->logger->error('Stale mapping: UUID @uuid for content_key @key not found. A new node will be created.', [
          '@uuid' => $entityUuid,
          '@key' => $contentKey,
        ]);
      }
    }

    if (!$node) {
      // Choose a base row (first or implement your own preference).
      $base = reset($rows);
      $baseLang = $this->normalizeLangcode($base['lang'] ?? $this->languageManager->getDefaultLanguage()->getId());
      $node = $storage->create([
        'type' => $bundle,
        'langcode' => $baseLang,
        'title' => ($base['title'] ?? '') !== '' ? $base['title'] : $contentKey,
      ]);
      $node->save();
      $map->set($contentKey, $node->uuid());
      $this->logger->notice('Created node @uuid for content_key @key.', [
        '@uuid' => $node->uuid(),
        '@key' => $contentKey,
      ]);
    }

    // Debug: show effective field map for this bundle.
    if (!empty($fieldMap)) {
      $this->logger->debug('Field map for bundle @bundle: @map', [
        '@bundle' => $bundle,
        '@map' => json_encode($fieldMap),
      ]);
    }
    else {
      $this->logger->debug('Field map for bundle @bundle is empty.', ['@bundle' => $bundle]);
    }

    // Upsert each language translation.
    foreach ($rows as $row) {
      $langcode = $this->normalizeLangcode($row['lang'] ?? 'und');

      $this->logger->debug('Upserting translation for content_key @key → row @row (requested lang: "@req", resolved: "@lang"). Node UUID (if any): @uuid', [
        '@key' => $contentKey,
        '@row' => (string) ($row['id'] ?? ''),
        '@req' => (string) ($row['lang'] ?? ''),
        '@lang' => $langcode,
        '@uuid' => $node ? $node->uuid() : 'NEW',
      ]);

      $existingLangs = array_map(fn($l) => $l->getId(), $node->getTranslationLanguages());
      $this->logger->debug($node->hasTranslation($langcode)
        ? 'Updating existing translation (@lang) for node @uuid. Existing translations: @langs'
        : 'Creating new translation (@lang) for node @uuid. Existing translations before create: @langs', [
        '@lang' => $langcode,
        '@uuid' => $node->uuid(),
        '@langs' => implode(',', $existingLangs),
      ]);

      // Avoid invalid langcodes; fall back to 'und'.
      if (!$this->languageManager->getLanguage($langcode)) {
        $this->logger->warning('Unknown langcode "@lang"; using "und".', ['@lang' => $langcode]);
        $langcode = 'und';
      }

      $translation = $node->hasTranslation($langcode)
        ? $node->getTranslation($langcode)
        : $node->addTranslation($langcode);

      $this->logger->debug('Obtained translation (@lang) for node @uuid. Current published state: @pub', [
        '@lang' => $langcode,
        '@uuid' => $node->uuid(),
        '@pub' => (string) (int) $translation->isPublished(),
      ]);

      // Map basic fields. Extend here for other mapped fields.
      $title = (string) ($row['title'] ?? '');
      if ($title !== '') {
        $translation->setTitle($title);
      }

      // Example: publish/unpublish per language from Notion 'estat'.
      $statusVal = $row['status'] ?? '';
      if (is_bool($statusVal)) {
        $statusVal ? $translation->setPublished() : $translation->setUnpublished();
      }
      else {
        $status = strtolower((string) $statusVal);
        if ($status === $statusPublishedValue) {
          $translation->setPublished();
        }
        else {
          $translation->setUnpublished();
        }
      }

      // Optional configurable field mapping: [drupal_field => notion_property].
      foreach ($fieldMap as $drupalField => $notionProp) {
        // Prefer flattened value from the original Notion row snapshot.
        $val = $row['_raw'][$notionProp] ?? NULL;
        // If still null and raw props exist, attempt to use the raw property as-is (some callers may handle arrays).
        if ($val === NULL && isset($row['_raw_props'][$notionProp])) {
          $val = $row['_raw_props'][$notionProp];
        }

        // Log when the Notion property is missing in this row.
        if ($val === NULL) {
          $this->logger->debug('Mapping skip (no value): @prop → @field (row @row).', [
            '@prop' => $notionProp,
            '@field' => $drupalField,
            '@row' => (string) ($row['id'] ?? ''),
          ]);
          continue;
        }

        // Prepare a readable preview for logs.
        $type = gettype($val);
        $preview = $val;
        if (is_array($val)) {
          $preview = json_encode($val);
        }
        if (is_string($preview) && strlen($preview) > 140) {
          $preview = substr($preview, 0, 140) . '…';
        }

        if ($translation->hasField($drupalField)) {
          try {
            $this->logger->debug('Mapping set: @prop (@type) → @field = @preview', [
              '@prop' => $notionProp,
              '@type' => $type,
              '@field' => $drupalField,
              '@preview' => is_scalar($preview) ? (string) $preview : '[complex]',
            ]);
            $translation->set($drupalField, $val);
          }
          catch (\Throwable $e) {
            $this->logger->error('Failed to set field "@field" from Notion property "@prop": @msg', [
              '@field' => $drupalField,
              '@prop' => $notionProp,
              '@msg' => $e->getMessage(),
            ]);
          }
        }
        else {
          if (empty($this->warnedMissingFields[$bundle][$drupalField])) {
            $this->logger->warning('Field "@field" not found in node type "@bundle"; skipping mapping from Notion property "@prop".', [
              '@field' => $drupalField,
              '@bundle' => $bundle,
              '@prop' => $notionProp,
            ]);
            $this->warnedMissingFields[$bundle][$drupalField] = TRUE;
          }
        }
      }

      // TODO: map additional fields as needed:
      // $translation->set('field_body', $row['_raw']['Body'] ?? NULL);
      // $translation->set('field_image', ...);

      $translation->save();
      $this->logger->debug('Saved translation (@lang) for node @uuid. Published: @pub', [
        '@lang' => $langcode,
        '@uuid' => $node->uuid(),
        '@pub' => (string) (int) $translation->isPublished(),
      ]);
    }
  }

  /**
   * Normalizes/validates a langcode; returns default language if invalid.
   *
   * @param string $langcode
   * @return string
   */
  private function normalizeLangcode(string $langcode): string {
    $raw = trim($langcode);
    if ($raw === '') {
      return $this->languageManager->getDefaultLanguage()->getId();
    }

    // Normalize basic shape: lowercase, underscores to dashes, keep primary subtag.
    $lc = strtolower(str_replace('_', '-', $raw));
    if (str_contains($lc, '-')) {
      $lc = explode('-', $lc, 2)[0];
    }

    // Map common aliases/names to langcodes.
    $aliases = [
      'es' => ['español', 'espanol', 'castellano', 'spanish'],
      'ca' => ['català', 'catala', 'catalan'],
      'en' => ['english', 'anglès', 'angles'],
      'fr' => ['français', 'frances', 'francès', 'french'],
      'de' => ['deutsch', 'alemany', 'aleman', 'german'],
      'it' => ['italiano', 'italià', 'italia', 'italian'],
    ];
    foreach ($aliases as $code => $names) {
      if ($lc === $code || in_array($lc, $names, TRUE)) {
        $lc = $code;
        break;
      }
    }

    // Final validation: if not enabled, fall back to site default but warn once per code.
    if (!$this->languageManager->getLanguage($lc)) {
      $fallback = $this->languageManager->getDefaultLanguage()->getId();
      $this->logger->warning('Langcode "@code" is not enabled; falling back to site default "@def". Enable this language in Drupal to create translations.', [
        '@code' => $lc,
        '@def' => $fallback,
      ]);
      return $fallback;
    }

    return $lc;
  }
}
