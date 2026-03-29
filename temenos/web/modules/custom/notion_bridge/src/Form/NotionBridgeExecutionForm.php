<?php

namespace Drupal\notion_bridge\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\State\StateInterface;
use Drupal\notion_bridge\ContentImporter;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Messenger\MessengerTrait;

/**
 * Provides a form to manually trigger a Notion → Drupal synchronization.
 */
class NotionBridgeExecutionForm extends FormBase {
  use MessengerTrait;

  /**
   * The service that handles the Notion-to-Drupal content import.
   *
   * @var \Drupal\notion_bridge\ContentImporter
   */
  protected ContentImporter $importer;

  /**
   * Logger channel for Notion bridge messages.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * State key-value store to persist last synchronization timestamps.
   *
   * @var \Drupal\Core\State\StateInterface
   */
  protected StateInterface $state;

  /**
   * Constructs the form object.
   *
   * @param \Drupal\notion_bridge\ContentImporter $importer
   *   The content importer service.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger service.
   * @param \Drupal\Core\State\StateInterface $state
   *   The state service.
   */
  public function __construct(ContentImporter $importer, LoggerInterface $logger, StateInterface $state) {
    $this->importer = $importer;
    $this->logger = $logger;
    $this->state = $state;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('notion_bridge.content_importer'),
      $container->get('logger.channel.notion_bridge'),
      $container->get('state')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'notion_bridge_execution_form';
  }

  /**
   * Builds the form.
   *
   * @param array $form
   *   The form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   *
   * @return array
   *   The built form.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $config = $this->config('notion_bridge.settings');
    $decoded = json_decode($config->get('config_json') ?? '[]', TRUE);

    $options = ['__all__' => $this->t('All databases')];
    foreach ($decoded as $entry) {
      if (!empty($entry['id']) && !empty($entry['name'])) {
        $options[trim($entry['id'])] = trim($entry['name']);
      }
    }

    $form['database'] = [
      '#type' => 'select',
      '#title' => $this->t('Select a Notion database'),
      '#options' => $options,
      '#required' => TRUE,
    ];

    $form['full_sync'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Force full synchronization (includes cleanup)'),
      '#default_value' => FALSE,
      '#description' => $this->t('Re-imports all pages and deletes orphaned Drupal content.'),
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Synchronize'),
      '#button_type' => 'primary',
    ];

    return $form;
  }

  /**
   * Handles form submission.
   *
   * @param array $form
   *   The form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The current state of the form.
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $selectedId  = (string) $form_state->getValue('database');
    $forceFull   = (bool)   $form_state->getValue('full_sync');

    $config      = $this->config('notion_bridge.settings');
    $allEntries  = json_decode($config->get('config_json') ?? '[]', TRUE);

    $entryById   = array_combine(array_column($allEntries, 'id'), $allEntries) ?: [];
    $operations  = [];

    /**
     * Helper to add batch operations for a given DB.
     *
     * @param string $dbId
     *   The Notion database ID.
     * @param array $entry
     *   The database configuration entry.
     */
    $addOps = function (string $dbId, array $entry) use (&$operations, $forceFull) {
      $last = $forceFull ? NULL : $this->state->get("notion_bridge.last_sync.$dbId", 0);
      $this->logger->debug('Preparing import batch for DB @id (forceFull: @force)', [
        '@id' => $dbId,
        '@force' => $forceFull ? 'yes' : 'no',
      ]);

      try {
        $ops = $this->importer->prepareImportBatch($dbId, $entry, $last);
        $this->logger->debug('DB @id prepared @count operations', [
          '@id' => $dbId,
          '@count' => count($ops),
        ]);
        if (!empty($ops)) {
          $operations = array_merge($operations, $ops);
        }
      }
      catch (\Throwable $e) {
        $this->logger->error('Error preparing batch for @id: @msg', [
          '@id'  => $dbId ?: '<empty>',
          '@msg' => $e->getMessage(),
        ]);
        $this->messenger()->addError($this->t(
          'Could not prepare batch for database @id: @msg',
          ['@id' => $dbId ?: '<empty>', '@msg' => $e->getMessage()]
        ));
      }
    };

    if ($selectedId === '__all__') {
      foreach ($entryById as $dbId => $entry) {
        if (trim($dbId) === '') {
          continue;
        }
        $addOps($dbId, $entry);
      }
    }
    else {
      $entry = $entryById[$selectedId] ?? NULL;
      if (!$entry) {
        $this->messenger()->addError($this->t('No configuration found for database @id.', ['@id' => $selectedId]));
        return;
      }
      $addOps($selectedId, $entry);
    }

    if (!$operations) {
      $this->messenger()->addWarning($this->t('No operations were prepared. Please check your configuration.'));
      return;
    }

    batch_set([
      'title'    => $this->t('Synchronising Notion content…'),
      'operations' => $operations,
      'finished' => [ContentImporter::class, 'batchFinished'],
    ]);
  }

  /**
   * Batch finished callback.
   *
   * @param bool $success
   *   TRUE if the batch completed successfully, FALSE otherwise.
   * @param array $results
   *   Results collected from batch operations.
   * @param array $operations
   *   Remaining operations if the batch was interrupted.
   */
  public static function batchFinished(bool $success, array $results, array $operations): void {
    $messenger = \Drupal::messenger();
    if ($success) {
      $messenger->addStatus(t('Notion synchronization completed.'));
      foreach ($results as $msg) {
        $messenger->addStatus($msg);
      }
    }
    else {
      $messenger->addError(t('Some errors occurred during synchronization.'));
    }
  }
}
