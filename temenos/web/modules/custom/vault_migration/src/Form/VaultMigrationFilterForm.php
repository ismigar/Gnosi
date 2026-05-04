<?php

namespace Drupal\vault_migration\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Database\Connection;
use Drupal\vault_migration\VaultClient;
use Psr\Log\LoggerInterface;

/**
 * Provides a form to filter Vault bridge mapping entries.
 *
 * This form adds UI filters to allow narrowing the results shown
 * on the status page by Vault database ID, Drupal node type, and publication status.
 */
class VaultMigrationFilterForm extends FormBase implements ContainerInjectionInterface {

  /**
   * The database connection service.
   *
   * @var \Drupal\Core\Database\Connection
   */
  protected Connection $database;

  /**
   * The Vault API client.
   *
   * @var \Drupal\vault_migration\VaultClient
   */
  protected VaultClient $vaultClient;

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
   * @param \Drupal\vault_migration\VaultClient $vault_client
   *   The Vault API client.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger service.
   */
  public function __construct(
    Connection $database,
    VaultClient $vault_client,
    LoggerInterface $logger
  ) {
    $this->database = $database;
    $this->vaultClient = $vault_client;
    $this->logger = $logger;
  }

  /**
   * Dependency injection factory.
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('database'),
      $container->get('vault_migration.vault_client'),
      $container->get('logger.channel.vault_migration')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'vault_migration_filter_form';
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

    // Fetch Vault database IDs from mapping table.
    $database_ids = $this->database->select('vault_migration_mapping', 'm')
      ->distinct()
      ->fields('m', ['database_id'])
      ->execute()
      ->fetchCol();

    $database_options = ['' => $this->t('- Any -')];

    foreach ($database_ids as $id) {
      try {
        $db = $this->vaultClient->retrieveDatabase($id);
        $title_array = $db['title'] ?? [];
        $title = $this->vaultClient->extractPlainText($title_array) ?: $id;
        $database_options[$id] = ucfirst($title);
      } catch (\Exception $e) {
        $this->logger->error("Error loading Vault DB [$id]: " . $e->getMessage());
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
    $form['#attached']['library'][] = 'vault_migration/vault_migration_filter_form';
    $form['#attributes']['class'][] = 'vault-migration-filter-form';

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

    $form_state->setRedirect('vault_migration.status', [], ['query' => $query]);
  }
}
