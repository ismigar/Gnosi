<?php

namespace Drupal\notion_bridge\Form;

use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Url;

/**
 * Provides a confirmation form to clear all Notion bridge mappings.
 *
 * This form is shown before truncating the 'notion_bridge_mapping' table,
 * asking the user to confirm the deletion.
 */
class NotionBridgeClearForm extends ConfirmFormBase {

  /**
   * The database connection.
   *
   * @var \Drupal\Core\Database\Connection
   */
  protected Connection $database;

  /**
   * Constructs the NotionBridgeClearForm object.
   *
   * @param \Drupal\Core\Database\Connection $database
   *   The database service injected via the container.
   */
  public function __construct(Connection $database) {
    $this->database = $database;
  }

  /**
   * {@inheritdoc}
   *
   * Factory method required for dependency injection.
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('database')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'notion_bridge_clear_form';
  }

  /**
   * {@inheritdoc}
   *
   * The question shown to the user before confirming.
   */
  public function getQuestion(): string {
    return $this->t('Are you sure you want to delete all synchronization records?');
  }

  /**
   * {@inheritdoc}
   *
   * The URL to return to when the user cancels the action.
   */
  public function getCancelUrl(): Url {
    return Url::fromRoute('notion_bridge.status');
  }

  /**
   * {@inheritdoc}
   *
   * Text shown on the confirmation button.
   */
  public function getConfirmText(): string {
    return $this->t('Yes, delete all');
  }

  /**
   * {@inheritdoc}
   *
   * Text shown on the cancel button.
   */
  public function getCancelText(): string {
    return $this->t('Cancel');
  }

  /**
   * {@inheritdoc}
   *
   * Executes the deletion logic when the form is submitted.
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $this->database->truncate('notion_bridge_mapping')->execute();
    $this->messenger()->addStatus($this->t('All records have been successfully deleted.'));
    $form_state->setRedirect('notion_bridge.status');
  }

}
