<?php

namespace Drupal\file_delete\Plugin\Action;

use Drupal\Core\Action\ActionBase;
use Drupal\Core\Action\Attribute\Action;
use Drupal\Core\Database\Connection;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\file\FileUsage\FileUsageInterface;

/**
 * Immediately deletes a file after usage checks passed.
 */
#[Action(
  id: 'immediate_delete',
  label: new TranslatableMarkup('Immediately delete (with usage checks)'),
  type: 'file'
)]
class ImmediateDeleteWithUsageChecks extends ActionBase implements ContainerFactoryPluginInterface {

  /**
   * Constructs a new ImmediateDeleteWithUsageChecks.
   *
   * @param array $configuration
   *   A configuration array containing information about the plugin instance.
   * @param string $plugin_id
   *   The plugin ID for the plugin instance.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   * @param \Drupal\file\FileUsage\FileUsageInterface $fileUsage
   *   The file usage service.
   * @param \Drupal\Core\File\FileSystemInterface $fileSystem
   *   The file system service.
   * @param \Drupal\Core\Database\Connection $database
   *   The current active database's master connection.
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected FileUsageInterface $fileUsage,
    protected FileSystemInterface $fileSystem,
    protected Connection $database,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('file.usage'),
      $container->get('file_system'),
      $container->get('database'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function execute($file = NULL): void {
    if ($file) {
      $list_usage = $this->fileUsage->listUsage($file);
      // Checking file usage.
      if ($list_usage) {
        $url = new Url('view.files.page_2', ['arg_0' => $file->id()]);
        $this->messenger()->addError($this->t('The file %file_name cannot be deleted because it is in use by the following modules: %modules.<br>Click <a href=":link_to_usages">here</a> to see its usages.', [
          '%file_name' => $file->getFilename(),
          '%modules' => implode(', ', array_keys($list_usage)),
          ':link_to_usages' => $url->toString(),
        ]));
        return;
      }
      // Delete file from filesystem and DB.
      if ($this->fileSystem->delete($file->getFileUri())) {
        $this->database->delete('file_managed')
          ->condition('fid', $file->id())
          ->execute();
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function access($object, ?AccountInterface $account = NULL, $return_as_object = FALSE) {
    return $object->access('delete', $account, $return_as_object);
  }

}
