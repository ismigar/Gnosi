<?php

namespace Drupal\notion_bridge\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Database\Connection;
use Drupal\notion_bridge\NotionClient;
use Psr\Log\LoggerInterface;

/**
 * Provides a form to filter Notion bridge mapping entries.
 *
 * This form adds UI filters to allow narrowing the results shown
 * on the status page by Notion database ID, Drupal node type, and publication status.
 */
class NotionBridgeFilterForm extends FormBase implements ContainerInjectionInterface {

  /**
   * The database connection service.
   *
   * @var \Drupal\Core\Database\Connection
   */
  protected Connection $database;

  /**
   * The Notion API client.
   *
   * @var \Drupal\notion_bridge\NotionClient
   */
  protected NotionClient $notionClient;

  /**
   * The logger service.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * Constructs the filter form.
   *
   * @param \Drupal\Core\Database\Connection $database
   *   The database connection.
   * @param \Drupal\notion_bridge\NotionClient $notion_client
   *   The Notion API client.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger service.
   */
  public function __construct(
    Connection $database,
    NotionClient $notion_client,
    LoggerInterface $logger
  ) {
    $this->database = $database;
    $this->notionClient = $notion_client;
    $this->logger = $logger;
  }

  /**
   * Dependency injection factory.
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('database'),
      $container->get('notion_bridge.notion_client'),
      $container->get('logger.channel.notion_bridge')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'notion_bridge_filter_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $request = $this->getRequest();

    // Load filter values from URL query.
    $database_id_filter = $request->query->get('database_id') ?? '';
    $type_filter = $request->query->get('type') ?? '';
    $status_filter = $request->query->get('status') ?? '';

    // Fetch Notion database IDs from mapping table.
    $database_ids = $this->database->select('notion_bridge_mapping', 'm')
      ->distinct()
      ->fields('m', ['database_id'])
      ->execute()
      ->fetchCol();

    $database_options = ['' => $this->t('- Any -')];

    foreach ($database_ids as $id) {
      try {
        $db = $this->notionClient->retrieveDatabase($id);
        $title_array = $db['title'] ?? [];
        $title = $this->notionClient->extractPlainText($title_array) ?: $id;
        $database_options[$id] = ucfirst($title);
      } catch (\Exception $e) {
        $this->logger->error("Error loading Notion DB [$id]: " . $e->getMessage());
        $database_options[$id] = $this->t('Unknown');
      }
    }

    // Fetch node types from node_field_data.
    $types = $this->database->select('node_field_data', 'n')
      ->fields('n', ['type'])
      ->distinct()
      ->execute()
      ->fetchCol();

    $type_options = ['' => $this->t('- Any -')];
    foreach ($types as $type) {
      $type_options[$type] = ucfirst($type);
    }

    $status_options = [
      '' => $this->t('- Any -'),
      '1' => $this->t('Yes'),
      '0' => $this->t('No'),
    ];

    // Attach optional JS and classes.
    $form['#attached']['library'][] = 'notion_bridge/notion_bridge_filter_form';
    $form['#attributes']['class'][] = 'notion-bridge-filter-form';

    // Build form elements.
    $form['database_id'] = [
      '#type' => 'select',
      '#title' => $this->t('Database'),
      '#options' => $database_options,
      '#default_value' => $database_id_filter,
    ];

    $form['type'] = [
      '#type' => 'select',
      '#title' => $this->t('Node type'),
      '#options' => $type_options,
      '#default_value' => $type_filter,
    ];

    $form['status'] = [
      '#type' => 'select',
      '#title' => $this->t('Published'),
      '#options' => $status_options,
      '#default_value' => $status_filter,
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Filter'),
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $query = [];

    foreach (['database_id', 'type', 'status'] as $param) {
      $value = $form_state->getValue($param);
      if ($value !== '') {
        $query[$param] = $value;
      }
    }

    $form_state->setRedirect('notion_bridge.status', [], ['query' => $query]);
  }
}
