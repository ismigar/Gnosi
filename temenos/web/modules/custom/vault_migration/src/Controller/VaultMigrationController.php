<?php

namespace Drupal\vault_migration\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Database\Connection;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Drupal\Core\Url;
use Drupal\Core\Link;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Pager\PagerManagerInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\vault_migration\VaultClient;
use Psr\Log\LoggerInterface;

/**
 * Controller for displaying the Vault Bridge sync status.
 */
class VaultMigrationController extends ControllerBase {

  /** @var \Drupal\Core\Database\Connection */
  protected Connection $database;

  /** @var \Drupal\Core\Render\RendererInterface */
  protected RendererInterface $renderer;

  /** @var \Drupal\Core\Pager\PagerManagerInterface */
  protected PagerManagerInterface $pagerManager;

  /** @var \Drupal\Core\Datetime\DateFormatterInterface */
  protected DateFormatterInterface $dateFormatter;

  /** @var \Drupal\vault_migration\VaultClient */
  protected VaultClient $vaultClient;

  /** @var \Psr\Log\LoggerInterface */
  protected LoggerInterface $logger;

  /** @var \Symfony\Component\HttpFoundation\RequestStack */
  protected RequestStack $requestStack;

  /** @var \Drupal\Core\Form\FormBuilderInterface */
  protected $formBuilder;

  /** @var \Drupal\Core\Cache\CacheBackendInterface */
  protected CacheBackendInterface $cache;

  /**
   * Constructs a VaultMigrationController object.
   *
   * @param \Drupal\Core\Database\Connection $database
   *   Database connection service.
   * @param \Drupal\Core\Render\RendererInterface $renderer
   *   Renderer service.
   * @param \Drupal\Core\Pager\PagerManagerInterface $pager_manager
   *   Pager manager service.
   * @param \Drupal\Core\Datetime\DateFormatterInterface $date_formatter
   *   Date formatter service.
   * @param \Drupal\vault_migration\VaultClient $vault_client
   *   Vault client service.
   * @param \Psr\Log\LoggerInterface $logger
   *   Channel logger for vault_migration.
   * @param \Symfony\Component\HttpFoundation\RequestStack $request_stack
   *   Request stack for accessing query params via DI.
   * @param \Drupal\Core\Form\FormBuilderInterface $form_builder
   *   Form builder via DI (avoid \Drupal::formBuilder()).
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache
   *   Cache backend for lightweight caching of Vault metadata.
   */
  public function __construct(
    Connection $database,
    RendererInterface $renderer,
    PagerManagerInterface $pager_manager,
    DateFormatterInterface $date_formatter,
    VaultClient $vault_client,
    LoggerInterface $logger,
    RequestStack $request_stack,
    FormBuilderInterface $form_builder,
    CacheBackendInterface $cache
  ) {
    $this->database = $database;
    $this->renderer = $renderer;
    $this->pagerManager = $pager_manager;
    $this->dateFormatter = $date_formatter;
    $this->vaultClient = $vault_client;
    $this->logger = $logger;
    $this->requestStack = $request_stack;
    $this->formBuilder = $form_builder;
    $this->cache = $cache;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('database'),
      $container->get('renderer'),
      $container->get('pager.manager'),
      $container->get('date.formatter'),
      $container->get('vault_migration.vault_client'),
      $container->get('logger.channel.vault_migration'),
      $container->get('request_stack'),
      $container->get('form_builder'),
      $container->get('cache.default')
    );
  }

  /**
   * Displays a paginated and sortable table with Vault→Drupal sync records.
   *
   * @return array
   *   A render array containing the filter form, action link, table, and pager.
   */
  public function status(): array {
    $limit = 50;
    $page = $this->pagerManager->findPage();
    $offset = $page * $limit;

    // Action link: delete all mapping records (kept as a render array).
    $delete_link = Link::fromTextAndUrl(
      $this->t('Delete all records'),
      Url::fromRoute('vault_migration.clear')
    )->toRenderable();
    $delete_link['#attributes']['class'] = ['button', 'button--danger'];

    // Read optional filters from the current request (via DI).
    $request = $this->requestStack->getCurrentRequest();
    $database_id_filter = $request->query->get('database_id');
    $type_filter = $request->query->get('type');
    $status_filter = $request->query->get('status');

    // Base query to fetch mapping records (joined with node data).
    $query = $this->database->select('vault_migration_mapping', 'm')
      ->fields('m', ['database_id', 'last_synced', 'vault_id', 'nid'])
      ->fields('n', ['type', 'status'])
      ->range($offset, $limit);
    $query->leftJoin('node_field_data', 'n', 'm.nid = n.nid');

    // Apply filters if provided.
    if (!empty($database_id_filter)) {
      $query->condition('m.database_id', $database_id_filter);
    }
    if (!empty($type_filter)) {
      $query->condition('n.type', $type_filter);
    }
    if ($status_filter !== NULL && $status_filter !== '') {
      $query->condition('n.status', (int) $status_filter);
    }

    // Define header with sortable columns (only for DB columns).
    $header = [
      'database_id' => [
        'data' => $this->t('Database'),
        'field' => 'm.database_id',
        'specifier' => 'database_id',
        'sort' => 'asc',
      ],
      'vault_id' => [
        'data' => $this->t('Page'),
        // Calculated value; not sortable at DB level.
      ],
      'last_synced' => [
        'data' => $this->t('Last sync'),
        'field' => 'm.last_synced',
        'specifier' => 'last_synced',
        'sort' => 'desc',
      ],
      'node_type' => [
        'data' => $this->t('Node type'),
        'field' => 'n.type',
        'specifier' => 'node_type',
      ],
      'status' => [
        'data' => $this->t('Published'),
        'field' => 'n.status',
        'specifier' => 'status',
      ],
      'node' => $this->t('Node link'),
    ];

    // Apply table sorting based on header configuration.
    $table_sort = $query->extend('Drupal\Core\Database\Query\TableSortExtender');
    $table_sort->orderByHeader($header);

    // Execute and build rows.
    $results = $query->execute()->fetchAll();
    $rows = [];

    foreach ($results as $row) {
      // Compute timestamp and format; tolerate both integer and string columns.
      $timestamp = !empty($row->last_synced)
        ? (is_numeric($row->last_synced) ? (int) $row->last_synced : strtotime($row->last_synced))
        : NULL;

      $formatted = is_int($timestamp)
        ? $this->dateFormatter->format($timestamp, 'custom', 'd/m/Y H:i')
        : '-';

      // Resolve Vault-driven labels via helper methods (cached + error-safe).
      $database_name = $this->getDatabaseName((string) $row->database_id);
      $page_title = $this->getPageTitle((string) $row->vault_id);

      // Compose render array for each row.
      $rows[] = [
        'database_id' => ['data' => ucfirst((string) $database_name)],
        'vault_id'   => ['data' => (string) $page_title],
        'last_synced' => ['data' => $formatted],
        'node_type'   => ['data' => ucfirst((string) ($row->type ?? '–'))],
        'status'      => ['data' => (!empty($row->status) ? $this->t('Yes') : $this->t('No'))],
        'node'        => ['data' => $this->buildNodeLink($row->nid ?? NULL, $row->nid ? 'Node ' . $row->nid : NULL)],
      ];
    }

    // Count total results for pager (reuse the same filters).
    $count_query = $this->database->select('vault_migration_mapping', 'm');
    $count_query->addExpression('COUNT(*)');
    $count_query->leftJoin('node_field_data', 'n', 'm.nid = n.nid');

    if (!empty($database_id_filter)) {
      $count_query->condition('m.database_id', $database_id_filter);
    }
    if (!empty($type_filter)) {
      $count_query->condition('n.type', $type_filter);
    }
    if ($status_filter !== NULL && $status_filter !== '') {
      $count_query->condition('n.status', (int) $status_filter);
    }

    $total = (int) $count_query->execute()->fetchField();
    $this->pagerManager->createPager($total, $limit);

    // Build filter form via DI instead of \Drupal::formBuilder().
    $form = $this->formBuilder->getForm(\Drupal\vault_migration\Form\VaultMigrationFilterForm::class);

    // Return a pure render array; avoid rendering in the controller.
    return [
      '#type' => 'container',
      'form' => $form,
      'delete_link' => $delete_link,
      'table' => [
        '#type' => 'table',
        '#header' => $header,
        '#rows' => $rows,
        '#empty' => $this->t('No records found.'),
      ],
      'pager' => ['#type' => 'pager'],
    ];
  }

  /**
   * Builds a renderable link to a node or a fallback markup if unassigned.
   *
   * @param int|null $nid
   *   The node ID, or NULL if not assigned.
   * @param string|null $label
   *   Optional link label. Defaults to a generic "View" label.
   *
   * @return array
   *   A render array representing the link or a fallback markup.
   */
  private function buildNodeLink(?int $nid, ?string $label = NULL): array {
    if (empty($nid)) {
      return ['#markup' => $this->t('Unassigned')];
    }
    $url = Url::fromRoute('entity.node.canonical', ['node' => $nid]);
    return Link::fromTextAndUrl($label ?? $this->t('View'), $url)->toRenderable();
  }

  /**
   * Retrieves a Vault database name with lightweight caching.
   *
   * @param string $databaseId
   *   The Vault database ID.
   *
   * @return string
   *   The human-readable database title or the raw ID on error.
   */
  private function getDatabaseName(string $databaseId): string {
    $cid = 'vault_migration:db_name:' . $databaseId;
    if ($cache = $this->cache->get($cid)) {
      return (string) $cache->data;
    }

    try {
      $db = $this->vaultClient->retrieveDatabase($databaseId);
      $name = $this->vaultClient->extractPlainText($db['title'] ?? []) ?: $databaseId;
      // Cache for 1 hour; adjust as needed or add tags if you later implement invalidation.
      $this->cache->set($cid, $name, time() + 3600);
      return $name;
    }
    catch (\Exception $e) {
      $this->logger->error('Vault DB fetch error (@db): @msg', [
        '@db' => $databaseId,
        '@msg' => $e->getMessage(),
      ]);
      return $databaseId;
    }
  }

  /**
   * Retrieves a Vault page title (first "title" property found).
   *
   * @param string $pageId
   *   The Vault page ID.
   *
   * @return string
   *   The page title or "Untitled" on error/empty.
   */
  private function getPageTitle(string $pageId): string {
    try {
      $page = $this->vaultClient->getPage($pageId);
      foreach (($page['properties'] ?? []) as $prop) {
        if (($prop['type'] ?? '') === 'title') {
          $title = $this->vaultClient->extractPlainText($prop);
          return $title ?: 'Untitled';
        }
      }
    }
    catch (\Exception $e) {
      $this->logger->error('Vault page fetch error (@page): @msg', [
        '@page' => $pageId,
        '@msg' => $e->getMessage(),
      ]);
    }
    return 'Untitled';
  }
}
