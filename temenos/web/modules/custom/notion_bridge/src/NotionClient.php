<?php

namespace Drupal\notion_bridge;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Http\ClientFactory;
use Drupal\path_alias\AliasManagerInterface;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\RequestException;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Site\Settings;
use Psr\Log\LoggerInterface;
use Drupal\notion_bridge\Exception\NotionClientException;
use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Component\Utility\Xss;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\File\FileSystemInterface;
use Psr\Http\Message\ResponseInterface;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\Core\Utility\Token;
use Drupal\file\FileRepositoryInterface;
use Drupal\Core\File\FileExists;
use Drupal\file\Entity\File;
use Drupal\file\FileInterface;
use Drupal\Component\Utility\UrlHelper;

/**
 * Service for interacting with the Notion API.
 *
 * This client handles authentication and requests to the Notion API using
 * Drupal's HTTP client system. It supports reading from databases and
 *  basic filtering, with retry logic and configurable API keys.
 */
class NotionClient implements CacheableDependencyInterface {
  use NotionApiErrorTrait;

  /**
   * Notion API version
   */
  private const NOTION_API_VERSION = '2022-06-28';

  /**
   * Maximum number of retry attempts for API requests.
   */
  private const MAX_RETRIES = 3;

  /**
   * Maximum execution time for API requests in seconds.
   */
  private const TIMEOUT = 60;

  /**
   * Maximum connection timeout in seconds.
   */
  private const CONNECT_TIMEOUT = 10;

  /**
   * HTTP client for making requests to the Notion API.
   *
   * @var \GuzzleHttp\ClientInterface
   */
  protected ClientInterface $httpClient;

  /**
   * Notion API integration token.
   *
   * @var string
   */
  protected string $notionApiKey;

  /**
   * Base URI for Notion API endpoints.
   *
   * @var string
   */
  protected string $baseUri = 'https://api.notion.com/v1/';

  /**
   * Configuration factory service.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $config;

  /**
   * Cache backend for storing API responses.
   *
   * @var \Drupal\Core\Cache\CacheBackendInterface
   */
  protected CacheBackendInterface $cache;

  /**
   * Logger channel for Notion integration.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * Time-to-live for cached items in seconds.
   *
   * @var int
   */
  protected int $cacheTtl;

  /**
   * Language manager service.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected LanguageManagerInterface $languageManager;

  /**
   * Time service.
   *
   * @var \Drupal\Component\Datetime\TimeInterface
   */
  protected TimeInterface $time;

  /**
   * File system service.
   *
   * @var \Drupal\Core\File\FileSystemInterface
   */
  protected FileSystemInterface $fileSystem;

  /**
   * Storage for Notion-to-Drupal mappings.
   *
   * @var \Drupal\notion_bridge\MappingStorage
   */
  protected MappingStorage $mappingStorage;

  /**
   * Inteface for traanslation messages.
   *
   * @var Drupal\Core\StringTranslation\TranslationInterface;
   */
  protected TranslationInterface $stringTranslation;

  /**
   * Entity Type Manager service.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The token service for replacing dynamic tokens.
   *
   * @var \Drupal\Core\Utility\Token
   */
  protected Token $token;

  /**
   * The file repository service.
   *
   * @var \Drupal\file\FileRepositoryInterface
   */
  protected FileRepositoryInterface $fileRepository;

  /**
   * The alias manager service used to resolve internal paths to URL aliases.
   *
   * @var \Drupal\Core\Path\AliasManagerInterface
   */
  protected AliasManagerInterface $aliasManager;

  /**
   * Queue of pending page property updates to be flushed in batch.
   * Each item: [pageId => string, props => array]
   *
   * @var array<int,array{pageId:string,props:array}>
   */
  protected array $updateQueue = [];

  /**
   * Constructs a NotionClient instance with all required dependencies.
   *
   * @param \Drupal\Core\Http\ClientFactory $client_factory
   *   Factory for Guzzle clients.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   Config factory for accessing module settings.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache_default
   *   Cache backend for storing Notion responses.
   * @param \Psr\Log\LoggerInterface $logger
   *   Logger channel for debugging.
   * @param \Drupal\Core\Language\LanguageManagerInterface $languageManager
   *   Language manager service.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   Time service for date management.
   * @param \Drupal\Core\File\FileSystemInterface $fileSystem
   *   Drupal file system service.
   * @param \Drupal\notion_bridge\MappingStorage $mappingStorage
   *   Mapping service for ID normalization.
   * @param \Drupal\Core\StringTranslation\TranslationInterface $stringTranslation
   *   Inteface for translation messages.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTipeManager
   *   Interface to manage entities.
   * @param \Drupal\Core\Utility\Token $token
   *    The token service for replacing dynamic tokens.
   * @param \Drupal\file\FileRepositoryInterface
   *    The file repository service.
   * @param \Drupal\Core\Path\AliasManagerInterface
   *    The alias manager service used to resolve internal paths to URL aliases.
   */
  public function __construct(
    ClientFactory $client_factory,
    ConfigFactoryInterface $config_factory,
    CacheBackendInterface $cache_default,
    LoggerInterface $logger,
    LanguageManagerInterface $languageManager,
    TimeInterface $time,
    FileSystemInterface $fileSystem,
    MappingStorage $mappingStorage,
    TranslationInterface $stringTranslation,
    EntityTypeManagerInterface $entityTypeManager,
    Token $token,
    FileRepositoryInterface $fileRepository,
    AliasManagerInterface $aliasManager
  ){
    // Prefer getting API key from settings.php (secure), fallback to config UI
    $this->notionApiKey = Settings::get('notion_api_key');

    if (empty($this->notionApiKey)) {
      $this->notionApiKey = trim($config_factory->get('notion_bridge.settings')->get('api_key') ?: '');
    }

    // Decode the key if it's base64-encoded
    if (is_string($this->notionApiKey) && base64_encode(base64_decode($this->notionApiKey, true)) === $this->notionApiKey) {
      $this->notionApiKey = base64_decode($this->notionApiKey);
    }

    // Get cache TTL from config, fallback to 600 seconds
    $this->cacheTtl = (int) $config_factory->get('notion_bridge.settings')->get('cache_ttl') ?: 600;

    // Create HTTP client with custom headers for Notion API
    $this->httpClient = $client_factory->fromOptions([
      'base_uri' => $this->baseUri,
      'timeout' => self::TIMEOUT,
      'connect_timeout' => self::CONNECT_TIMEOUT,
      'headers' => [
        'Authorization'   => 'Bearer ' . $this->notionApiKey,
        'Notion-Version'  => self::NOTION_API_VERSION,
        'Content-Type'    => 'application/json',
        'User-Agent'      => 'DrupalNotionBridge/1.0',
      ],
    ]);

    $this->config = $config_factory;
    $this->cache = $cache_default;
    $this->logger = $logger;
    $this->languageManager = $languageManager;
    $this->time = $time;
    $this->fileSystem = $fileSystem;
    $this->mappingStorage = $mappingStorage;
    $this->stringTranslation = $stringTranslation;
    $this->entityTypeManager = $entityTypeManager;
    $this->token = $token;
    $this->fileRepository = $fileRepository;
    $this->aliasManager = $aliasManager;
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheableMetadata(): CacheableMetadata {
    $metadata = new CacheableMetadata();
    $metadata->setCacheMaxAge($this->cacheTtl);
    $metadata->addCacheTags(['notion_bridge']);
    return $metadata;
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheMaxAge(): int {
    return $this->getCacheableMetadata()->getCacheMaxAge();
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheTags(): array {
    return $this->getCacheableMetadata()->getCacheTags();
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return $this->getCacheableMetadata()->getCacheContexts();
  }

  /**
   * Returns the cache TTL configured for Notion responses.
   *
   * @return int
   *   Time to live in seconds.
   */
  public function getCacheTtl(): int {
    return $this->cacheTtl;
  }


  /**
   * Executes a callback with automatic retries on HTTP 429 errors (rate limiting).
   *
   * This method uses exponential backoff: 1s, 2s, 4s... until max retries are reached.
   * It is intended to wrap Notion API calls that podrían fallar temporalment per límits de ràtio.
   *
   * @param callable $fn
   *   The operation to execute. It should return a response or throw an exception.
   * @param int $retries
   *   Maximum number of retry attempts. Default is self::MAX_RETRIES.
   * @param int $baseDelay
   *   Base delay in seconds before retrying. Actual delay is baseDelay * (2 ^ attempt).
   *
   * @return mixed
   *   The result returned by the callback if successful.
   *
   * @throws \Drupal\notion_bridge\Exception\NotionClientException
   *   If the operation fails after all retries or throws an unexpected exception.
   */
  private function retry(callable $fn, int $retries = self::MAX_RETRIES, int $baseDelay = 1): mixed {
    $attempt = 0;

    while (TRUE) {
      try {
        return $fn();
      }
      catch (RequestException $e) {
        $url = $e->getRequest()?->getUri()?->__toString() ?? 'unknown';

        if ($e->getCode() !== 429 || $attempt >= $retries) {
          $this->logger->error('❌ [download] HTTP error: @code - @message. URL: @url', [
            '@code' => $e->getResponse()?->getStatusCode() ?? 'N/A',
            '@message' => $e->getMessage(),
            '@url' => $url,
          ]);

          throw new NotionClientException('Error communicating with Notion:' . $e->getMessage(), $e->getCode(), $e);
        }

        $delay = $baseDelay * (2 ** $attempt);
        $this->logger->warning("⏳ Notion 429: waiting {$delay}s before retrying (attempt {$attempt}).");
        sleep($delay);
        $attempt++;
      }
      catch (\Throwable $e) {
        $this->logger->error('❌ [retry] Unexpected exception: @msg', ['@msg' => $e->getMessage()]);
        throw new NotionClientException('Unexpected error communicating with Notion.', 0, $e);
      }
    }
  }


  /**
   * Returns the current Notion API key.
   *
   * @return string
   *   The API key stored in configuration.
   */
  public function getNotionApiKey(): string {
    return Settings::get('notion_api_key') ?? '';
  }


  /* -------------------------------------------------------------------- */
  /*   DATABASE QUERIES                                                   */
  /* -------------------------------------------------------------------- */

  /**
   * Queries a Notion database and returns the page results.
   *
   * @param string $databaseId
   *   The Notion database ID.
   * @param array $filter
   *   Optional Notion JSON filter (structure must follow Notion API format).
   *
   * @return array
   *   A list of page results from the query.
   *
   * @throws \Drupal\notion_bridge\Exception\NotionClientException
   *   If an unhandled request error occurs.
   */
  public function queryDatabase(string $databaseId, array $filter = []): array {
    // Detect if $filter is an associative array (not an indexed list)
    $is_associative = function (array $array): bool {
      return count(array_filter(array_keys($array), 'is_string')) > 0;
    };

    $body = (!empty($filter) && $is_associative($filter))
      ? ['filter' => $filter]
      : new \stdClass();

    try {
      $response = $this->request('POST', "databases/{$databaseId}/query", $body);

      $body = $response->getBody();
      if ($body->getSize() > 1024 * 1024 * 5) {
        // Més de 5MB
        $this->logger->warning('⚠️ Response body too large: @size bytes', ['@size' => $body->getSize()]);
      }

      $data = $this->validateJsonResponse(
        $this->decodeJson($body->getContents()),
        'queryDatabase',
        ['results']
      );
      return $data['results'] ?? [];
    }
    catch (\Throwable $e) {
      $this->logger->error('❌ Notion query failed: @msg', ['@msg' => $e->getMessage()]);
      throw new NotionClientException('Error communicating with Notion: ' . $e->getMessage(), 0, $e);
    }
  }

  /**
   * Queries all pages from a Notion database, following pagination via `next_cursor`.
   *
   * This method automatically handles rate limits and retries. It merges all pages
   * into a single array of results, using optional filters and page size control.
   *
   * @param string $database_id
   * @param array $filter
   * @return \Generator
   */
  public function queryDatabaseAll(string $database_id, array $filter = []): \Generator {
    $endpoint = "databases/{$database_id}/query";
    $isAssociative = fn(array $a) => count(array_filter(array_keys($a), 'is_string')) > 0;

    $payload = [];
    if (!empty($filter) && $isAssociative($filter)) {
      $payload['filter'] = $filter;
    }

    $hasMore = true;
    $startCursor = null;

    while ($hasMore) {
      if ($startCursor !== null) {
        $payload['start_cursor'] = $startCursor;
      }

      $response = $this->request('POST', $endpoint, $payload);

      $data = $this->validateJsonResponse(
        Json::decode($response->getBody()->getContents(), 'json'),
        'queryDatabaseAll',
        ['results']
      );

      foreach ($data['results'] as $page) {
        yield $page;
      }

      $hasMore = $data['has_more'] ?? false;
      $startCursor = $data['next_cursor'] ?? null;
    }
  }

  /**
   * Retrieves metadata of a Notion database with optional in-memory caching.
   *
   * This method returns the schema (properties) of a Notion database and logs errors
   * if the response is malformed or fails. Uses a static runtime cache.
   *
   * @param string $databaseId
   *   The Notion database ID.
   * @param bool $useCache
   *   Whether to use a local in-memory cache to avoid redundant API calls.
   *
   * @return array|null
   *   Database metadata as an associative array, or NULL on failure.
   */
  public function retrieveDatabase(string $databaseId, bool $useCache = TRUE): ?array {
    static $cache = [];

    if (empty($databaseId)) {
      $this->logger->error('❌ No database ID was provided for metadata retrieval.');
      return null;
    }

    if ($useCache && isset($cache[$databaseId])) {
      return $cache[$databaseId];
    }

    try {
      $response = $this->retry(function () use ($databaseId) {
        return $this->request('GET', "databases/{$databaseId}");
      });

      $body = Json::decode($response->getBody()->getContents(), 'json');

      if (!is_array($body) || empty($body['properties'])) {
        $this->logger->error('❌ Notion response for DB @id does not contain valid properties.', ['@id' => $databaseId]);
        return null;
      }

      return $cache[$databaseId] = $body;
    }
    catch (RequestException $e) {
      $this->logger->error('🌐 HTTP error retrieving DB @id: @msg', [
        '@id' => $databaseId,
        '@msg' => $e->getMessage(),
      ]);
    }
    catch (\Throwable $e) {
      $this->logger->error('💥 Unexpected error retrieving DB @id: @msg', [
        '@id' => $databaseId,
        '@msg' => $e->getMessage(),
      ]);
    }

    return null;
  }

  /**
   * Retrieves the children blocks of a given Notion block (e.g., content inside a page).
   *
   * @param string $blockId
   *   The ID of the parent block.
   *
   * @return array
   *   List of child blocks or an empty array if retrieval fails.
   */
  public function getBlockChildren(string $blockId): array {
    try {
      $response = $this->retry(function () use ($blockId) {
        return $this->request("GET","blocks/{$blockId}/children");
      });
      $data = Json::decode($response->getBody()->getContents(), 'json');
      return $data['results'] ?? [];
    } catch (\Exception $e) {
      $this->logger->error('Failed to get block children: @msg', ['@msg' => $e->getMessage()]);
      return [];
    }
  }

  /**
   * Searches the Notion workspace for all databases (up to 100).
   *
   * Uses Notion's /search endpoint and filters only database objects.
   *
   * @return array
   *   List of databases with their ID and name.
   *
   * @throws \Exception
   *   If the API fails after retries.
   */
  public function searchDatabases(): array {
    $payload = [
      'query' => '',
      'filter' => [
        'value' => 'database',
        'property' => 'object',
      ],
    ];

    $attempt = 0;
    do {
      try {
        $response = $this->retry(function () use ($payload) {
          return $this->request("POST",'search', $payload);
        });
        break;
      } catch (RequestException $e) {
        if ($e->getCode() === 429 && $attempt < self::MAX_RETRIES) {
          sleep((int) $e->getResponse()->getHeaderLine('Retry-After') ?: 1);
        } else {
          throw new \Exception('Error searching Notion databases: ' . $e->getMessage());
        }
      }
      ++$attempt;
    } while ($attempt <= self::MAX_RETRIES);

    $data = $this->validateJsonResponse(
      Json::decode($response->getBody()->getContents(), 'json'),
      'searchDatabases',
      ['results']
    );

    $results = $data['results'] ?? [];

    $databases = [];
    foreach ($results as $item) {
      if (!empty($item['id'])) {
        $name = $item['title'][0]['plain_text'] ?? $item['id'];
        $databases[] = ['id' => $item['id'], 'name' => $name];
      }
    }

    // Sort alphabetically
    usort($databases, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    return $databases;
  }

  /**
   * Retrieves raw property definitions of a Notion database.
   *
   * @param string $databaseId
   *   The Notion database ID.
   *
   * @return array
   *   Raw database object including properties.
   *
   * @throws NotionClientException
   *   When the request fails or Notion returns an error.
   */
  public function getDatabaseProperties(string $databaseId): array {
    $cid = 'notion_bridge:database:' . $databaseId;

    if ($cache = $this->cache->get($cid)) {
      return $cache->data;
    }

    try {
      $response = $this->retry(function () use ($databaseId) {
        return $this->request('GET', "databases/{$databaseId}");
      });

      $data = Json::decode($response->getBody()->getContents(), 'json');
      $data = $this->validateJsonResponse($data, 'getDatabaseProperties', ['properties']);

      $this->cache->set($cid, $data, time() + $this->cacheTtl);
      return $data;
    }
    catch (\GuzzleHttp\Exception\RequestException $e) {
      $message = '❌ Notion API request exception for DB ' . $databaseId . ': ' . $e->getMessage();
      if ($e->hasResponse()) {
        $body = $e->getResponse()->getBody()->getContents();
        $message .= ' | Response: ' . $body;
      }
      $this->logger->error($message);
      throw new NotionClientException("Failed to retrieve Notion database properties: " . $e->getMessage(), 0, $e);
    }
    catch (\Throwable $e) {
      $this->logger->error('⚠️ Unexpected error while loading Notion DB @id: @msg', [
        '@id' => $databaseId,
        '@msg' => $e->getMessage(),
      ]);
      throw new NotionClientException("Unexpected error communicating with Notion: " . $e->getMessage(), 0, $e);
    }
  }

  /**
   * Retrieves a single Notion page with caching.
   *
   * @param string $pageId
   *   The Notion page ID.
   *
   * @return array
   *   The full page object.
   *
   * @throws NotionClientException
   *   On HTTP or decoding error.
   */
  public function getPage(string $pageId): array {
    $cid = 'notion_bridge:page:' . $pageId;

    if ($cache = $this->cache->get($cid)) {
      return $cache->data;
    }

    try {
      $response = $this->retry(function () use ($pageId) {
        return $this->request('GET', "pages/{$pageId}");
      });

      $data = $this->validateJsonResponse(
        Json::decode($response->getBody()->getContents(), 'json'),
        'getPage',
        ['properties']
      );

      $this->cache->set($cid, $data, time() + $this->cacheTtl);

      return $data;
    }
    catch (\GuzzleHttp\Exception\RequestException $e) {
      $message = '❌ Notion API request exception for page ' . $pageId . ': ' . $e->getMessage();
      if ($e->hasResponse()) {
        $body = $e->getResponse()->getBody()->getContents();
        $message .= ' | Response: ' . $body;
      }
      $this->logger->error($message);
      throw new NotionClientException("Failed to retrieve Notion page: " . $e->getMessage(), 0, $e);
    }
    catch (\Throwable $e) {
      $this->logger->error('⚠️ Unexpected error while loading Notion page @id: @msg', [
        '@id' => $pageId,
        '@msg' => $e->getMessage(),
      ]);
      throw new NotionClientException("Unexpected error communicating with Notion: " . $e->getMessage(), 0, $e);
    }
  }

  /**
   * Returns a simplified [property_name => type] array for a given database.
   *
   * @param string $databaseId
   *   The Notion database ID.
   *
   * @return array
   *   Associative array of property names and their types.
   */
  public function getPropertyTypes(string $databaseId): array {
    $types = [];

    try {
        $meta  = $this->getDatabaseProperties($databaseId);
        $props = $meta['properties'] ?? [];
        foreach ($props as $name => $def) {
            $types[$name] = $def['type'] ?? 'rich_text';
        }
    } catch (\Exception $e) {
      $this->logger->warning('Could not retrieve property types for @id: @msg', [
        '@id' => $databaseId,
        '@msg' => $e->getMessage(),
      ]);
    }

    return $types;
  }

  /**
   * Sends an HTTP request to the Notion API with retry and error handling.
   *
   * @param string $method
   *   The HTTP method (e.g., 'GET', 'POST').
   * @param string $uri
   *   The URI relative to Notion's base path (e.g., 'databases/xyz').
   * @param array $body
   *   Optional body payload to send as JSON.
   *
   * @return \Psr\Http\Message\ResponseInterface
   *   The successful HTTP response.
   *
   * @throws \RuntimeException
   *   When the request fails or returns a non-success status code.
   */
  private function request(string $method, string $uri, array $body = []): ResponseInterface {
    $options = [
      'headers' => [
        'Authorization'   => 'Bearer ' . $this->notionApiKey,
        'Notion-Version'  => self::NOTION_API_VERSION,
        'Content-Type'    => 'application/json',
      ],
    ];

    if (!empty($body)) {
      $options['body'] = json_encode($body);
    }

    try {
      /** @var \Psr\Http\Message\ResponseInterface $response */
      $response = $this->retry(function () use ($method, $uri, $options) {
        return $this->httpClient->request($method, ltrim($uri, '/'), $options);
      });

      $status = $response->getStatusCode();
      if ($status < 200 || $status >= 300) {
        $message = $response->getBody()->getContents();
        $this->logger->error('Notion API returned non-success status @code for @uri: @msg', [
          '@code' => $status,
          '@uri' => $uri,
          '@msg' => $message,
        ]);
        throw new \RuntimeException("Request to Notion API failed with status $status: $message");
      }

      return $response;
    }
    catch (RequestException $e) {
      $this->logger->error('HTTP request error to Notion API @method @uri: @error', [
        '@method' => $method,
        '@uri' => $uri,
        '@error' => $e->getMessage(),
      ]);
      throw new \RuntimeException("HTTP request error to Notion: " . $e->getMessage(), 0, $e);
    }
    catch (\Throwable $e) {
      $this->logger->error('Unexpected error during Notion API request @method @uri: @error', [
        '@method' => $method,
        '@uri' => $uri,
        '@error' => $e->getMessage(),
      ]);
      throw new \RuntimeException("Unexpected error during Notion request: " . $e->getMessage(), 0, $e);
    }
  }

  /**
   * Builds a Notion API filter to include only "published" entries.
   *
   * This method supports filtering based on various Notion property types,
   * such as checkbox, select, status, formula, title, and rich_text.
   * It returns a clean filter clause directly usable in a Notion query.
   *
   * Accepted values for textual fields include translations of:
   * - "yes", "true", "published", "sí", "publicat"
   *
   * @param array $propertyMeta
   *   Metadata of the Notion property (from database schema).
   * @param string $propertyName
   *   The name of the Notion property to filter on.
   *
   * @return array
   *   A Notion-compatible filter clause (not wrapped inside 'filter' key).
   */
  public function buildPublishFilter(array $propertyMeta, string $propertyName): array {
    if (!isset($propertyMeta['type'])) {
      return [];
    }

    $type = $propertyMeta['type'];
    $translated = fn($value) => (string) $this->t($value);

    // Common values that indicate a page is published.
    $textValues = [
      $translated('yes'),
      $translated('true'),
      $translated('published'),
    ];

    switch ($type) {
      case 'checkbox':
        return [
          'property' => $propertyName,
          'checkbox' => ['equals' => true],
        ];

      case 'select':
        return [
          'property' => $propertyName,
          'select' => ['equals' => $translated('Published')],
        ];

      case 'status':
        return [
          'property' => $propertyName,
          'status' => ['equals' => $translated('Published')],
        ];

      case 'formula':
        $formulaType = $propertyMeta['formula']['type'] ?? null;
        if ($formulaType === 'boolean') {
          return [
            'property' => $propertyName,
            'formula' => ['boolean' => ['equals' => true]],
          ];
        }
        if ($formulaType === 'string') {
          return [
            'property' => $propertyName,
            'formula' => ['string' => ['equals' => $translated('Published')]],
          ];
        }
        break;

      case 'title':
      case 'rich_text':
      default:
        // Compose an OR condition for textual matches.
        return [
          'or' => array_map(function (string $val) use ($propertyName) {
            return [
              'property' => $propertyName,
              'rich_text' => ['equals' => $val],
            ];
          }, $textValues),
        ];
    }

    return [];
  }

  /**
   * Determines whether a Notion page is marked as published.
   *
   * This method checks the property configured as "publish field" and evaluates
   * its value depending on its type (checkbox, formula, text, select, etc.).
   *
   * Supported values include: 'published', 'true', 'sí', 'si' (translated).
   *
   * @param array $item
   *   The complete Notion page object.
   * @param string|null $publishFieldKey
   *   The property name used to determine publication status.
   *
   * @return bool
   *   TRUE if the page is marked as published, FALSE otherwise.
   */
  public function isPublished(array $item, ?string $publishFieldKey): bool {
    if (!$publishFieldKey || empty($item['properties'][$publishFieldKey])) {
      return false;
    }

    $field = $item['properties'][$publishFieldKey];
    $type = $field['type'] ?? null;

    // List of accepted values, translated.
    $accepted = array_map(
      fn($v) => strtolower((string) $this->t($v)),
      ['published', 'true', 'sí', 'si']
    );

    // 1. Formula type.
    if ($type === 'formula' && isset($field['formula']['type'])) {
      $formula = $field['formula'];
      if ($formula['type'] === 'boolean') {
        return (bool) $formula['boolean'];
      }
      if ($formula['type'] === 'string') {
        return in_array(strtolower(trim($formula['string'] ?? '')), $accepted, true);
      }
    }

    // 2. Checkbox.
    if ($type === 'checkbox') {
      return !empty($field['checkbox']);
    }

    // 3. Select or Status.
    if (in_array($type, ['select', 'status'], true)) {
      $value = $field[$type]['name'] ?? '';
      return in_array(strtolower(trim($value)), $accepted, true);
    }

    // 4. Rich text or title.
    foreach (['title', 'rich_text'] as $textType) {
      if (!empty($field[$textType]) && is_array($field[$textType])) {
        $text = implode('', array_column($field[$textType], 'plain_text'));
        $text_normalized = strtolower(trim($text));

        // Translate the text for comparison if needed
        $translated_text = strtolower(trim((string) $this->t($text_normalized)));

        if (in_array($text_normalized, $accepted, true) || in_array($translated_text, $accepted, true)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Renders a Notion page (block children) as basic HTML.
   * Skips rendering if inside a "Notes" section.
   *
   * @param string $pageId
   *   The Notion page ID.
   *
   * @return string
   *   Rendered HTML.
   */
  public function renderNotionPageAsHtml(string $pageId): string {
    $pageId = $this->mappingStorage->normalizeNotionId($pageId);

    try {
      $blocks = $this->getBlockChildren($pageId);
    } catch (\Exception $e) {
      $this->logger->error('Error loading Notion blocks: @msg', ['@msg' => $e->getMessage()]);
      return '';
    }

    $html = '';
    $openList = false;
    $skipNotes = false;

    foreach ($blocks as $block) {
      $type = $block['type'];
      $content = $block[$type] ?? [];

      // Skip "Notes" section if found
      if ($skipNotes) {
        if (in_array($type, ['heading_1', 'heading_2', 'heading_3', 'paragraph'])) {
          $heading_text = mb_strtolower(trim($this->renderRichText($content['rich_text'] ?? [])));
          if (!in_array($heading_text, ['notes', 'notes:'])) {
            $skipNotes = false;
          } else {
            continue;
          }
        } else {
          continue;
        }
      }

      switch ($type) {
        case 'heading_2':
          $heading_text = mb_strtolower(trim($this->renderRichText($content['rich_text'] ?? [])));
          if (in_array($heading_text, ['notes', 'notes:'])) {
            $skipNotes = true;
            continue 2;
          }
          $html .= '<h3>' . $this->renderRichText($content['rich_text'] ?? []) . '</h3>';
          break;

        case 'heading_1':
          $html .= '<h2>' . $this->renderRichText($content['rich_text'] ?? []) . '</h2>';
          break;

        case 'heading_3':
          $html .= '<h4>' . $this->renderRichText($content['rich_text'] ?? []) . '</h4>';
          break;

        case 'paragraph':
          $html .= '<p>' . $this->renderRichText($content['rich_text'] ?? []) . '</p>';
          break;

        case 'bulleted_list_item':
          if (!$openList) {
            $html .= '<ul>';
            $openList = true;
          }
          $html .= '<li>' . $this->renderRichText($content['rich_text'] ?? []) . '</li>';
          break;

        default:
          if ($openList) {
            $html .= '</ul>';
            $openList = false;
          }
          break;
      }
    }

    if ($openList) {
      $html .= '</ul>';
    }

    return $html;
  }

  /**
   * Renders an array of rich text blocks as HTML (basic links only).
   *
   * @param array $richText
   *   Array of rich text parts from Notion.
   *
   * @return string
   *   Plain or HTML-enhanced content.
   */
  public function renderRichText(array $richText): string {
    $html = '';
    foreach ($richText as $part) {
      $plain = htmlspecialchars($part['plain_text'] ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

      // Handle explicit external links.
      if (!empty($part['href'])) {
        $href = htmlspecialchars($part['href'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $html .= '<a href="' . $href . '" target="_blank" rel="noopener noreferrer">' . $plain . '</a>';
        continue;
      }

      // Handle @mentions to pages.
      if (
        ($part['type'] ?? null) === 'mention' &&
        ($part['mention']['type'] ?? null) === 'page' &&
        isset($part['mention']['page']['id'])
      ) {
        $notionId = $this->mappingStorage->normalizeNotionId($part['mention']['page']['id']);

        // Try to resolve immediately to a Drupal alias; if we can't, leave a placeholder
        // that downstream processors (batch/cron) can replace later.
        $nid = $this->mappingStorage->getNodeIdByNotionId($notionId);
        if ($nid) {
          $alias = $this->aliasManager->getAliasByPath('/node/' . $nid);
          $html .= '<a href="' . htmlspecialchars($alias, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">' . $plain . '</a>';
        }
        else {
          // Leave a clear marker to be post-processed: <span data-notion-id="...">text</span>
          $html .= '<span data-notion-id="' . htmlspecialchars($notionId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">' . $plain . '</span>';
        }

        continue;
      }

      // Fallback: just output the plain text.
      $html .= $plain;
    }

    return Xss::filterAdmin($html);
  }

  /**
   * Extracts rich text from a Notion property (title or rich_text).
   *
   * @param array $property
   *   A Notion property array.
   *
   * @return string
   *   Rendered plain or HTML text.
   */
  public function extractRichText(array $property): string {
    $richText = $property['rich_text'] ?? ($property['title'] ?? []);
    return $this->renderRichText($richText);
  }

  /**
   * Extracts the start date (as timestamp) from a Notion 'date' property.
   *
   * @param array $property
   *   The property array, expected to contain ['date']['start'].
   *
   * @return int|null
   *   UNIX timestamp or NULL if parsing fails.
   */
  public function extractDateStart(array $property): ?int {
    if (!empty($property['date']['start'])) {
      try {
        return (new \DateTimeImmutable($property['date']['start']))->getTimestamp();
      } catch (\Exception $e) {
        $this->logger->warning('Invalid date format: @val', ['@val' => $property['date']['start']]);
      }
    }
    return null;
  }

  /**
   * Extracts selected names from a multi_select Notion property.
   *
   * @param array $property
   *   Property with 'multi_select' key.
   *
   * @return array
   *   Array of selected names (strings).
   */
  public function extractMultiSelect(array $property): array {
    return !empty($property['multi_select']) ? array_column($property['multi_select'], 'name') : [];
  }

  /**
   * Attempts to find an existing file with the same URI and content hash.
   *
   * @param string $uri
   *   The full file URI (e.g., "public://resources/file.pdf").
   * @param string $content
   *   The binary content of the file to compare against.
   *
   * @return \Drupal\file\FileInterface|null
   *   The matching file entity, or NULL if none was found.
   */
  protected function loadDuplicateFile(string $uri, string $content): ?FileInterface {
    try {
      $realpath = $this->fileSystem->realpath($uri);
      if (file_exists($realpath)) {
        $existing_hash = hash_file('sha256', $realpath);
        $new_hash = hash('sha256', $content);
        $existing_size = filesize($realpath);
        $new_size = strlen($content);

        if ($existing_hash === $new_hash && $existing_size === $new_size) {
          $files = $this->entityTypeManager->getStorage('file')->loadByProperties(['uri' => $uri]);
          foreach ($files as $file) {
            if ($file instanceof FileInterface) {
              if ($file->isTemporary()) {
                $file->setPermanent();
                $file->save();
              }
              return $file;
            }
          }
        }
      }
    } catch (\Throwable $e) {
      $this->logger->error('Exception during deduplication check: @msg', ['@msg' => $e->getMessage()]);
    }
    return null;
  }

  /**
   * Writes file content to disk and returns a file entity.
   *
   * @param string $content
   *   The raw binary content to write.
   * @param string $uri
   *   The destination URI where the file should be saved.
   * @param string $filename
   *   The name of the file (used for metadata only).
   *
   * @return \Drupal\file\FileInterface|null
   *   The file entity, or NULL if saving failed.
   */
  protected function writeOrCreateFile(string $content, string $uri, string $filename): ?FileInterface {
    try {
      $file = $this->fileRepository->writeData($content, $uri, FileExists::Replace);
      if ($file instanceof FileInterface) {
        return $file;
      }

      $this->logger->error('writeData() failed. Falling back to manual file entity creation. URI: @uri', ['@uri' => $uri]);
      $realpath = $this->fileSystem->realpath($uri);
      if (!file_exists($realpath)) {
        $this->logger->error('File missing from disk before manual File::create(): @path', ['@path' => $realpath]);
        return null;
      }

      $file = File::create([
        'uri' => $uri,
        'status' => FileInterface::STATUS_PERMANENT,
        'filename' => $filename,
      ]);
      $file->save();
      return $file;
    } catch (\Throwable $e) {
      $this->logger->error('Exception during writeData or manual file creation: @message', [
        '@message' => $e->getMessage(),
      ]);
      return null;
    }
  }

  /**
   * Downloads a Notion-hosted image or file and stores it in the public file system.
   *
   * @param array $prop
   *   Property with ['file']['url'] key.
   *
   * @return int|null
   *   Drupal file entity ID if successful, NULL on failure.
   */
  public function handleImageOrFile(array $prop): ?int {
    if (empty($prop['file']['url'])) {
      return null;
    }

    $url = $prop['file']['url'];
    $filename = basename(parse_url($url, PHP_URL_PATH));

    try {
      $data = file_get_contents($url);
      $uri = $this->fileSystem->saveData($data, 'public://' . $filename, FileSystemInterface::EXISTS_RENAME);
      $file = File::create(['uri' => $uri]);
      $file->save();
      return $file->id();
    } catch (\Exception $e) {
      $this->error('Error downloading Notion file: @msg', ['@msg' => $e->getMessage()]);
      return null;
    }
  }

  /**
   * Parses a human-readable size string (e.g. "2 MB") into bytes.
   *
   * @param string|null $size
   *   The size string (e.g., "2 MB", "500K", or "1048576").
   *
   * @return int
   *   The corresponding size in bytes.
   */
  private function parseSize(?string $size): int {
    if (!$size) return 0;

    $size = trim($size);
    if (is_numeric($size)) return (int) $size;

    $units = [
      'B' => 1,
      'K' => 1024,
      'KB' => 1024,
      'M' => 1048576,
      'MB' => 1048576,
      'G' => 1073741824,
      'GB' => 1073741824,
    ];

    $number = (float) $size;
    $unit = strtoupper(trim(str_replace((string) $number, '', $size)));

    return isset($units[$unit]) ? (int) ($number * $units[$unit]) : (int) $number;
  }

  /**
   * Generate a fresh URL file to download.
   *
   * @param array $file_data
   *   Propertie Notion file.
   *
   * @return string|null
   *   The new URL or null if is not possible to generate it.
   */
  public function getFreshFileUrl(array $file_data): ?string {
    // External: no expire, we can directly return.
    if (!empty($file_data['external']['url'])) {
      return $file_data['external']['url'];
    }

    // Signed URL de Notion (file): We validate if it expired.
    if (!empty($file_data['file']['url']) && !empty($file_data['file']['expiry_time'])) {
      $expiry = strtotime($file_data['file']['expiry_time']);
      if ($expiry && $expiry > time()) {
        return $file_data['file']['url'];
      }

      $this->logger->warning('⚠️ File URL has expired and cannot be refreshed individually.');
      return null;
    }

    $this->logger->debug('[DEBUG] getFreshFileUrl → raw: @raw', [
      '@raw' => json_encode($file_data, JSON_UNESCAPED_SLASHES),
    ]);

    return null;
  }

  /**
   * Extracts plain text from various Notion property formats.
   *
   * @param array $property
   *   The Notion property.
   *
   * @return string
   *   Plain text content.
   */
  public function extractPlainText(array $property): string {
    // General case: array with plain rich text
    if (isset($property[0]['plain_text'])) {
      return implode('', array_column($property, 'plain_text'));
    }

    // Common cases: 'title', 'rich_text' or 'select'
    foreach (['title', 'rich_text'] as $key) {
      if (!empty($property[$key]) && is_array($property[$key])) {
        return implode('', array_column($property[$key], 'plain_text'));
      }
    }

    // Alternative case: simple select
    return $property['select']['name'] ?? '';
  }


  /**
   * Extracts the name of the selected option from a Notion select property.
   *
   * @param array $property
   *   Notion select property array.
   *
   * @return string
   *   The selected option name, or an empty string if not set.
   */
  public function extractSelectValue(array $property): string {
    return $property['select']['name'] ?? '';
  }

/**
 * Extracts normalized Notion page IDs from a relation property.
 *
 * @param array $property
 * @return array
 */
  public function extractRelationIds(array $property): array {
    $ids = [];
    if (!empty($property['relation']) && is_array($property['relation'])) {
        foreach ($property['relation'] as $rel) {
            if (!empty($rel['id']) && is_string($rel['id'])) {
                $ids[] = $this->mappingStorage->normalizeNotionId($rel['id']);
            }
        }
    }
    if (empty($ids) && isset($property[0]) && is_string($property[0])) {
        foreach ($property as $maybeId) {
            if (is_string($maybeId) && $maybeId !== '') {
                $ids[] = $this->mappingStorage->normalizeNotionId($maybeId);
            }
        }
    }
    return $ids;
  }

    /**
     * Returns flattened rows for the given bundle (database).
     *
     * @param string $bundle
     * @return \Generator<int,array>
     *   Each row has: id, flattened props, and _raw_props.
     */
    public function fetchRows(string $bundle): \Generator {
        $dbId = \Drupal::config('notion_bridge.settings')->get("databases.$bundle");
        if (!$dbId || !is_string($dbId)) {
            throw new \RuntimeException("Bundle '$bundle' is not configured under notion_bridge.settings:databases.");
        }

        // Obté totes les pàgines (usa el mètode disponible al teu client).
        if (method_exists($this, 'queryDatabaseAll')) {
            $pages = $this->queryDatabaseAll($dbId);
        } elseif (method_exists($this, 'queryDatabase')) {
            $pages = $this->queryDatabase($dbId);
        } else {
            throw new \RuntimeException('NotionClient lacks queryDatabaseAll/queryDatabase methods.');
        }

        foreach ($pages as $page) {
            $properties = is_array($page['properties'] ?? null) ? $page['properties'] : [];
            $flat = [];
            $flat['_raw_props'] = $properties;

            foreach ($properties as $name => $prop) {
                $flat[$name] = $this->flattenProperty(is_array($prop) ? $prop : []);
            }

            $rawId = is_string($page['id'] ?? null) ? $page['id'] : '';
            if (method_exists($this, 'mappingStorage') && method_exists($this->mappingStorage, 'normalizeNotionId')) {
                $flat['id'] = $this->mappingStorage->normalizeNotionId($rawId) ?: $rawId;
            } elseif (property_exists($this, 'mappingStorage') && method_exists($this->mappingStorage, 'normalizeNotionId')) {
                $flat['id'] = $this->mappingStorage->normalizeNotionId($rawId) ?: $rawId;
            } else {
                // Normalitza mínimament: treu guions si cal.
                $flat['id'] = str_replace('-', '', $rawId);
            }

            yield $flat;
        }
    }

    /**
     * Updates one or more properties on a Notion page.
     *
     * Scalars → rich_text, booleans → checkbox.
     */
    public function updatePageProperties(string $pageId, array $properties): void {
        $normalized = [];
        foreach ($properties as $name => $value) {
            if (is_array($value)) {
                $normalized[$name] = $value;
            } elseif (is_bool($value)) {
                $normalized[$name] = ['checkbox' => $value];
            } else {
                $normalized[$name] = $this->asRichTextProperty((string) $value);
            }
        }
        $this->request('PATCH', "pages/{$pageId}", ['properties' => $normalized]);
    }

    /**
     * Enqueue a Notion page properties update to be sent on flush().
     *
     * @param string $pageId
     * @param array $properties
     */
    public function queueUpdate(string $pageId, array $properties): void {
      $this->updateQueue[] = [
        'pageId' => $pageId,
        'props'  => $properties,
      ];
    }

    /**
     * Sends all queued Notion page updates. Safe to call even if the queue is empty.
     */
    public function flush(): void {
      if (empty($this->updateQueue)) {
        return;
      }
      // Drain the queue first to avoid re-entrancy issues.
      $queue = $this->updateQueue;
      $this->updateQueue = [];

      foreach ($queue as $item) {
        $pageId = (string) ($item['pageId'] ?? '');
        $props  = is_array($item['props'] ?? null) ? $item['props'] : [];
        if ($pageId === '' || $props === []) {
          continue;
        }
        // Reuse the single-call helper; it already normalizes payloads.
        $this->updatePageProperties($pageId, $props);
      }
    }

  /** Wraps a string as a Notion rich_text property payload. */
    protected function asRichTextProperty(string $value): array {
        return [
            'rich_text' => [[
                'type' => 'text',
                'text' => ['content' => $value],
            ]],
        ];
    }

    /**
     * Infers the language code from a Notion field mapped to 'langcode'.
     *
     * @param array $item
     *   Notion page object.
     * @param array $mapping
     *   Notion-to-Drupal field mapping.
     *
     * @return string
     *   Language code (e.g. 'en', 'ca').
     */
    public function getLangcode(array $item, array $mapping): string {
        $notionLangField = array_search('langcode', $mapping, TRUE);
        if ($notionLangField !== FALSE && isset($item['properties'][$notionLangField])) {
            $value = $this->extractSelectValue($item['properties'][$notionLangField])
                ?: $this->extractPlainText($item['properties'][$notionLangField]);
            if (!empty($value)) {
                return $this->normalizeLangcode($value);
            }
        }
        return $this->languageManager->getDefaultLanguage()->getId();
    }

    /**
     * Gets the creation timestamp for a Notion item from a mapped field.
     *
     * Falls back to current time if invalid or missing.
     *
     * @param array $item
     *   Full Notion page.
     * @param array $mapping
     *   Field mapping array.
     *
     * @return int
     *   Unix timestamp for created time.
     */
    public function getCreatedDate(array $item, array $mapping): int {
        $notionDateField = array_search('created', $mapping, TRUE);
        if ($notionDateField === FALSE || empty($item['properties'][$notionDateField])) {
            return $this->time->getRequestTime();
        }

        $date_val = $this->extractDateStart($item['properties'][$notionDateField]);

        if (empty($date_val)) {
            $raw_date = $this->extractPlainText($item['properties'][$notionDateField]);
            if (!empty($raw_date)) {
                try {
                    $date_val = (new \DateTimeImmutable($raw_date))->getTimestamp();
                } catch (\Exception $e) {
                    $this->logger->warning('Invalid created date: @val', ['@val' => $raw_date]);
                    $date_val = null;
                }
            }
        }

        if (empty($date_val)) {
            return $this->time->getRequestTime();
        }

        if ($date_val > 2147483647) {
            $this->logger->warning('Timestamp out of 32-bit range: @val', ['@val' => $date_val]);
            return $this->time->getRequestTime();
        }

        return (int) $date_val;
    }

  /**
   * Download a remote file (e.g., Notion's S3 presigned URL) into a temp file
   * and return its binary contents, or null on failure.
   *
   * @param string      $url       Direct downloadable URL (no Notion token).
   * @param string|null $filename  Only for logging purposes.
   * @param int         $max_size  Max bytes to accept (default 20MB).
   *
   * @return string|null
   */
  public function download(string $url, ?string $filename = null, int $max_size = 20971520): ?string {
    try {
      // 1) Crea un fitxer temporal real dins Drupal (temporary://).
      $tmpUri = $this->fileSystem->tempnam('temporary://', 'notion_');
      $handle = fopen($tmpUri, 'w+');
      if ($handle === false) {
        $this->logger->error('❌ [download] No s\'ha pogut crear el fitxer temporal: @f', ['@f' => $tmpUri]);
        return null;
      }

      // 2) Fes el GET net (sense capçaleres d'autenticació de Notion).
      $this->logger->debug('📥 [download] GET: @url → @tmp', ['@url' => $url, '@tmp' => $tmpUri]);

      $this->httpClient->request('GET', $url, [
        'sink'            => $handle,
        'allow_redirects' => true,
        'timeout'         => 45,
        'http_errors'     => true,
        'headers'         => [
          'Accept'     => '*/*',
        ],
      ]);

      fflush($handle);
      $meta     = stream_get_meta_data($handle);
      $realpath = $meta['uri'] ?? $this->fileSystem->realpath($tmpUri);
      fclose($handle);

      if (!file_exists($realpath)) {
        $this->logger->error('❌ [download] Fitxer inexistent després del GET: @p', ['@p' => $realpath]);
        return null;
      }

      $size = filesize($realpath) ?: 0;
      if ($size === 0) {
        $this->logger->error('❌ [download] Fitxer buit després del GET: @p', ['@p' => $realpath]);
        @unlink($realpath);
        return null;
      }
      if ($size > $max_size) {
        $this->logger->warning('⚠️ [download] Ometent @f per mida (@s bytes > límit @m)', [
          '@f' => $filename ?? 'unknown', '@s' => $size, '@m' => $max_size,
        ]);
        @unlink($realpath);
        return null;
      }

      $data = file_get_contents($realpath);
      @unlink($realpath);
      return $data !== false ? $data : null;
    }
    catch (\GuzzleHttp\Exception\RequestException $e) {
      $status = $e->getResponse() ? $e->getResponse()->getStatusCode() : 0;
      $body   = $e->getResponse() ? mb_substr((string) $e->getResponse()->getBody(), 0, 300) : '';
      $this->logger->error('❌ [download] HTTP error (@code) per @file: @msg. Body: @body', [
        '@code' => $status,
        '@file' => $filename ?? 'unknown',
        '@msg'  => $e->getMessage(),
        '@body' => $body,
      ]);
      return null;
    }
    catch (\Throwable $e) {
      $this->logger->error('❌ [download] Error general per @file: @msg', [
        '@file' => $filename ?? 'unknown',
        '@msg'  => $e->getMessage(),
      ]);
      return null;
    }
  }

  /**
   * Resolves and downloads a Notion file and saves it as a file entity.
   *
   * @param array $file_property
   *   The Notion file property (e.g., ['file' => ['url' => ..., 'expiry_time' => ...]]).
   * @param string $filename
   *   The filename to use (can be derived from basename($url)).
   *
   * @return \Drupal\file\FileInterface|null
   *   The file entity if saved successfully, or NULL on failure.
   */
  public function resolveAndDownloadFile(array $file_property, string $filename): ?FileInterface {
    $url = $this->getFreshFileUrl($file_property);
    if (!$url) {
      $this->logger->error('❌ [resolveAndDownloadFile] No fresh URL available for @filename', ['@filename' => $filename]);
      return null;
    }

    $content = $this->download($url, $filename);
    if ($content === null || strlen($content) === 0) {
      $this->logger->error('❌ [resolveAndDownloadFile] Downloaded file is empty or unreadable: @filename', ['@filename' => $filename]);
      return null;
    }

    $uri = 'public://' . preg_replace('/[^a-zA-Z0-9_\-.]+/', '_', $filename);

    $existing = $this->loadDuplicateFile($uri, $content);
    if ($existing) {
      $this->logger->debug('♻️ [resolveAndDownloadFile] Reusing existing file: @filename', ['@filename' => $filename]);
      return $existing;
    }

    $file = $this->writeOrCreateFile($content, $uri, $filename);
    if ($file) {
      $this->logger->debug('✅ [resolveAndDownloadFile] File saved: @uri', ['@uri' => $file->getFileUri()]);
    }
    return $file;
  }

  /**
   * Safely decodes a JSON string into a PHP array.
   *
   * Uses Drupal's internal Json component. If the input is not valid JSON,
   * logs the error and throws an exception with contextual information.
   *
   * @param string $json
   *   The JSON string to decode.
   *
   * @return array
   *   The decoded PHP array.
   *
   * @throws \Drupal\notion_bridge\Exception\NotionClientException
   *   When the JSON string cannot be decoded.
   */
  private function decodeJson(string $json): array {
    try {
      return Json::decode($json);
    }
    catch (\InvalidArgumentException $e) {
      $this->logger->error('❌ Failed to decode JSON response: @msg', [
        '@msg' => $e->getMessage(),
      ]);
      throw new NotionClientException('Invalid JSON response received from Notion.', 0, $e);
    }
  }

  /**
   * Extracts content blocks from a Notion page.
   * Adds support to detect internal Notion page links (mentions).
   *
   * @param string $page_id
   *   The ID of the Notion page.
   *
   * @return array
   *   An array of blocks with extracted internal links.
   */
  public function extractPageContentWithMentions(string $page_id): array {
    $blocks = $this->getBlockChildren($page_id);
    $content = [];

    foreach ($blocks as $block) {
      if (!isset($block['type'])) {
        continue;
      }

      $type = $block['type'];
      $data = $block[$type] ?? [];

      // Basic text extraction (rich_text).
      if (!empty($data['rich_text'])) {
        $text = '';
        foreach ($data['rich_text'] as $part) {
          if (isset($part['type']) && $part['type'] === 'mention') {
            $mention = $part['mention'];
            if (isset($mention['page']['id'])) {
              $ref_id = $mention['page']['id'];
              // Insert placeholder for later replacement.
              $text .= "[[NOTION_REF:$ref_id]]";
              continue;
            }
          }

          $plain = $part['plain_text'] ?? '';
          $text .= $plain;
        }
        $content[] = $text;
      }
      // Optionally process other block types here (e.g. headings, quotes...)
    }

    return $content;
  }

    /**
     * Normalize and validate an external URL (http/https).
     *
     * @param string|null $raw
     * @return string|null
     */
    protected function normalizeExternalUrl(?string $raw): ?string {
        if (!is_string($raw)) {
            return null;
        }
        $url = html_entity_decode(trim($raw), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // Collapse inner whitespace.
        $url = preg_replace('/\s+/', '', $url ?? '');
        if ($url === '' || in_array($url, ['http://', 'https://'], true)) {
            return null;
        }
        // Add scheme if clearly missing (domain.tld[/...])
        if (!preg_match('#^[a-z][a-z0-9+.-]*://#i', $url)) {
            if (preg_match('#^[\w.-]+\.[a-z]{2,}(/.*)?$#i', $url)) {
                $url = 'https://' . $url;
            }
        }
        if (!UrlHelper::isValid($url, TRUE)) {
            return null;
        }
        $scheme = strtolower((string)parse_url($url, PHP_URL_SCHEME));
        return in_array($scheme, ['http', 'https'], true) ? $url : null;
    }

    /**
     * Extract first valid http(s) URL from an HTML snippet (<a href="...">).
     *
     * @param string|null $html
     * @return string|null
     */
    protected function extractUrlFromHtml(?string $html): ?string {
        if (!is_string($html) || trim($html) === '') {
            return null;
        }
        $doc = new \DOMDocument();
        @$doc->loadHTML('<?xml encoding="utf-8" ?>' . $html);
        foreach ($doc->getElementsByTagName('a') as $a) {
            $u = $this->normalizeExternalUrl($a->getAttribute('href') ?? '');
            if ($u) {
                return $u;
            }
        }
        return null;
    }

    /**
     * Deeply search for the first usable URL inside a Notion property payload.
     *
     * @param mixed $prop
     * @return string|null
     */
    public function findFirstUrlInNotionProperty(mixed $prop): ?string {
        // 0) Raw string: plain URL or HTML with <a href>.
        if (is_string($prop)) {
            // Try HTML first (anchor), then plain URL guess.
            return $this->extractUrlFromHtml($prop) ?? $this->normalizeExternalUrl($prop);
        }

        if (!is_array($prop)) {
            return null;
        }

        // 1) Direct 'url' key from Notion 'url' property.
        if (isset($prop['url']) && is_string($prop['url'])) {
            if ($u = $this->normalizeExternalUrl($prop['url'])) {
                return $u;
            }
        }

        // 2) rich_text / title arrays with parts possibly having href or text.link.url
        foreach (['rich_text', 'title'] as $k) {
            if (!empty($prop[$k]) && is_array($prop[$k])) {
                foreach ($prop[$k] as $part) {
                    $href = $part['href'] ?? ($part['text']['link']['url'] ?? null);
                    if ($href && ($u = $this->normalizeExternalUrl($href))) {
                        return $u;
                    }
                }
                // No hrefs: if concatenated plain_text looks like URL, accept.
                $plain = trim(implode('', array_map(fn($p) => $p['plain_text'] ?? '', $prop[$k])));
                if ($plain && ($u = $this->normalizeExternalUrl($plain))) {
                    return $u;
                }
            }
        }

        // 3) files: external/file arrays
        if (!empty($prop['files']) && is_array($prop['files'])) {
            foreach ($prop['files'] as $file) {
                // external
                if (!empty($file['external']['url']) && ($u = $this->normalizeExternalUrl($file['external']['url']))) {
                    return $u;
                }
                // file (signed URL)
                if (!empty($file['file']['url']) && ($u = $this->normalizeExternalUrl($file['file']['url']))) {
                    return $u;
                }
            }
        }

        // 4) formula(string)
        if (!empty($prop['formula']) && is_array($prop['formula'])) {
            if (!empty($prop['formula']['string']) && ($u = $this->normalizeExternalUrl($prop['formula']['string']))) {
                return $u;
            }
        }

        // 5) rollup: can be 'array' with nested rich_text/files/etc.
        if (!empty($prop['rollup']) && is_array($prop['rollup'])) {
            // common: ['rollup' => ['array' => [ ...sub-items... ]]]
            $arr = $prop['rollup']['array'] ?? null;
            if (is_array($arr)) {
                foreach ($arr as $item) {
                    if ($u = $this->findFirstUrlInNotionProperty($item)) {
                        return $u;
                    }
                }
            }
        }

        // 6) If Notion uses 'type' => 'X' and value under that key.
        if (!empty($prop['type']) && isset($prop[$prop['type']])) {
            if ($u = $this->findFirstUrlInNotionProperty($prop[$prop['type']])) {
                return $u;
            }
        }

        // 7) Generic deep scan as fallback.
        foreach ($prop as $v) {
            if ($u = $this->findFirstUrlInNotionProperty($v)) {
                return $u;
            }
        }

        return null;
    }

    /**
     * Normalize a language code or name to a Drupal langcode.
     *
     * This method handles case-insensitive codes, regional variants (e.g. es-ES),
     * common language names and aliases, and falls back to the site default
     * if the code is not enabled in Drupal.
     *
     * @param string $langcode
     * @return string
     */
    private function normalizeLangcode(string $langcode): string {
        $raw = trim($langcode);
        if ($raw === '') {
            return $this->languageManager->getDefaultLanguage()->getId();
        }

        // Lowercase, replace underscores, strip region (keep primary subtag), and trim.
        $lc = strtolower(str_replace('_', '-', $raw));
        if (str_contains($lc, '-')) {
            $lc = explode('-', $lc, 2)[0];
        }

        // Map common language names/aliases to Drupal langcodes.
        $aliases = [
            'es' => ['español', 'espanol', 'castellano', 'spanish'],
            'ca' => ['català', 'catala', 'catalan'],
            'en' => ['english', 'inglés', 'ingles'],
            'fr' => ['francès', 'frances', 'french'],
            'de' => ['alemany', 'aleman', 'german'],
            'it' => ['italià', 'italia', 'italian'],
            // Afegiu aquí altres variants si cal.
        ];

        if (!$this->languageManager->getLanguage($lc)) {
            // Try alias lookup when $lc is actually a name.
            foreach ($aliases as $code => $names) {
                if ($lc === $code || in_array($lc, $names, TRUE)) {
                    $lc = $code;
                    break;
                }
            }
        }

        // Final validation against enabled site languages.
        if (!$this->languageManager->getLanguage($lc)) {
            return $this->languageManager->getDefaultLanguage()->getId();
        }

        return $lc;
    }

    /**
     * Flatten a Notion property to a usable value.
     *
     * @param array $prop
     * @return mixed
     */
    protected function flattenProperty(array $prop): mixed {
        $type = $prop['type'] ?? 'rich_text';
        switch ($type) {
            case 'relation':
                return $this->extractRelationIds($prop);

            case 'checkbox':
                return (bool) ($prop['checkbox'] ?? FALSE);

            case 'select':
                return (string) ($prop['select']['name'] ?? '');

            case 'status':
                return (string) ($prop['status']['name'] ?? '');

            case 'title':
            case 'rich_text':
                $arr = $prop[$type] ?? [];
                $out = '';
                foreach ($arr as $part) {
                    if (!empty($part['plain_text']) && is_string($part['plain_text'])) {
                        $out .= $part['plain_text'];
                    } elseif (!empty($part['text']['content'])) {
                        $out .= (string) $part['text']['content'];
                    }
                }
                return $out;

            case 'formula':
                $f = $prop['formula'] ?? [];
                if (array_key_exists('string', $f))  { return (string) ($f['string'] ?? ''); }
                if (array_key_exists('number', $f))  { return (string) ($f['number'] ?? ''); }
                if (array_key_exists('boolean', $f)) { return (bool) ($f['boolean'] ?? FALSE); }
                if (!empty($f['date']['start']))     { return (string) $f['date']['start']; }
                return '';

            case 'rollup':
                $r = $prop['rollup'] ?? [];
                if (($r['type'] ?? '') === 'array' && !empty($r['array'])) {
                    $txt = '';
                    foreach ($r['array'] as $item) {
                        $txtPart = $this->flattenProperty($item);
                        if (is_string($txtPart)) { $txt .= $txtPart; }
                    }
                    return $txt;
                }
                if (($r['type'] ?? '') === 'number') { return (string) ($r['number'] ?? ''); }
                if (($r['type'] ?? '') === 'date' && !empty($r['date']['start'])) { return (string) $r['date']['start']; }
                return '';

            default:
                if (!empty($prop['rich_text'])) {
                    return $this->flattenProperty(['type' => 'rich_text', 'rich_text' => $prop['rich_text']]);
                }
                return '';
        }
    }

    /**
   * Translates a string.
   *
   * @param string $string
   *  The string to translate. If empty, an empty string is returned.
   * @param array $args
   *   An array of replacement arguments for the translated string.
   * @param array $options
   *   An array of options to pass to the \Drupal\Core\StringTranslation\TranslatableMarkup constructor.
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup
   *   The translated string.
   */
  protected function t($string = '', array $args = [], array $options = []): \Drupal\Core\StringTranslation\TranslatableMarkup {
    return $string !== '' ? $this->stringTranslation->translate($string, $args, $options) : '';
  }
}
