<?php

namespace Drupal\file_delete\Plugin\Action;

use Drupal\Core\Action\ActionBase;
use Drupal\Core\Action\Attribute\Action;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\file\FileUsage\FileUsageInterface;

/**
 * Marks a file for deletion by setting it to temporary.
 */
#[Action(
  id: 'mark_file_for_deletion',
  label: new TranslatableMarkup('Mark file for deletion'),
  type: 'file'
)]
class MarkFileForDeletion extends ActionBase implements ContainerFactoryPluginInterface {

  /**
   * Constructs a new MarkFileForDeletion.
   *
   * @param array $configuration
   *   A configuration array containing information about the plugin instance.
   * @param string $plugin_id
   *   The plugin ID for the plugin instance.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   * @param \Drupal\file\FileUsage\FileUsageInterface $fileUsage
   *   The file usage service.
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected FileUsageInterface $fileUsage,
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
      $container->get('file.usage')
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
      // Mark the file for removal by file_cron().
      $file->setTemporary();
      $file->save();

    }
  }

  /**
   * {@inheritdoc}
   */
  public function access($object, ?AccountInterface $account = NULL, $return_as_object = FALSE) {
    return $object->access('delete', $account, $return_as_object);
  }

}
