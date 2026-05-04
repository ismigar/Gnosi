<?php

namespace Drupal\file_delete\Form;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Component\Plugin\Exception\InvalidPluginDefinitionException;
use Drupal\Component\Plugin\Exception\PluginNotFoundException;
use Drupal\Core\Entity\ContentEntityConfirmFormBase;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteProviderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\file\FileUsage\FileUsageInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * Provides a form for deleting a File.
 */
class FileDeleteForm extends ContentEntityConfirmFormBase {

  /**
   * The file being deleted.
   *
   * @var \Drupal\file\FileInterface
   */
  protected $entity;

  /**
   * {@inheritdoc}
   */
  public function __construct(
    protected FileUsageInterface $fileUsage,
    protected RouteProviderInterface $routeProvider,
    protected AccountInterface $account,
    EntityRepositoryInterface $entity_repository,
    EntityTypeBundleInfoInterface $entity_type_bundle_info,
    ?TimeInterface $time = NULL,
  ) {
    parent::__construct($entity_repository, $entity_type_bundle_info, $time);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('file.usage'),
      $container->get('router.route_provider'),
      $container->get('current_user'),
      $container->get('entity.repository'),
      $container->get('entity_type.bundle.info'),
      $container->get('datetime.time')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form = parent::buildForm($form, $form_state);
    $config = $this->config('file_delete.settings');

    if ($config->get('force_delete') && $this->account->hasPermission('delete files override usage')) {
      $this->messenger()->addWarning($this->t('You are currently overriding usage of files, file deletion may cause links or media to not show up. Proceed with caution.'));
    }
    if ($config->get('instant_delete') && $this->account->hasPermission('delete files immediately')) {
      $this->messenger()->addWarning($this->t('This file will be instantly deleted.'));
    }

    $form['instant_delete'] = [
      '#description' => $this->t("This option will skip Drupal's file cleanup method and delete the file directly."),
      '#type' => 'checkbox',
      '#default_value' => $config->get('instant_delete'),
      '#title' => $this->t('Do you want to delete the file immediately?'),
      '#access' => $this->account->hasPermission('delete files immediately'),
    ];

    $form['force_delete'] = [
      '#type' => 'checkbox',
      '#default_value' => $config->get('force_delete'),
      '#title' => $this->t('Do you want to force this file to be deleted?'),
      '#access' => $this->account->hasPermission('delete files override usage'),
      '#description' => $this->t('This option will override the usages check, which could result in a broken link. To avoid this, remove all usages of the file first.  Requires "Delete any media" permission.'),
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion(): TranslatableMarkup {
    return $this->t('Are you sure you want to delete the file %file_name (%file_path)?', [
      '%file_name' => $this->entity->getFilename(),
      '%file_path' => $this->entity->getFileUri(),
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl(): Url {
    return new Url('view.files.page_1');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText(): TranslatableMarkup {
    return $this->t('Delete File');
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    try {
      $this->messenger()->deleteByType('warning');
      $usages = $this->fileUsage->listUsage($this->entity);
      $usage_override = $form_state->getValue('force_delete') && $this->account->hasPermission('delete files override usage');
      $instant_delete = $form_state->getValue('instant_delete') && $this->account->hasPermission('delete files immediately');

      if (isset($usages['file'])) {
        foreach ($usages['file'] as $type => $entities) {
          foreach ($entities as $id => $usage_count) {
            $ref_entity = $this->entityTypeManager->getStorage($type)->load($id);
            if (!empty($ref_entity)) {
              $ref_entity->delete();

              $this->messenger()
                ->addMessage($this->t('The reference from entity type %ref_type for file %file_name has been deleted.', [
                  '%ref_type' => $ref_entity->getEntityType()->id(),
                  '%file_name' => $this->entity->getFilename(),
                ]));
            }
          }
        }
      }

      // If the file is in use, and we don't want to force delete, cancel the
      // deletion and set error message.
      if ($usages && !$usage_override) {
        $fileUsagesUrl = $this->getFileUsagesUrl($this->entity->id());

        // If we cannot get the File Usages View, show a simpler message.
        if (FALSE === $fileUsagesUrl) {
          $this->messenger()
            ->addError($this->t('The file %file_name cannot be deleted because it is in use by the following modules: %modules.', [
              '%file_name' => $this->entity->getFilename(),
              '%modules' => implode(', ', array_keys($usages)),
            ]));

          return;
        }

        $this->messenger()
          ->addError($this->t('The file %file_name cannot be deleted because it is in use by the following modules: %modules.<br>Click <a href=":link_to_usages">here</a> to see its usages.', [
            '%file_name' => $this->entity->getFilename(),
            '%modules' => implode(', ', array_keys($usages)),
            ':link_to_usages' => $fileUsagesUrl,
          ]));

        return;
      }

      $form_state->setRedirect('view.files.page_1');

      // If instant_delete is TRUE, delete the file.
      if ($instant_delete) {
        $this->entity->delete();
        $this->messenger()
          ->addMessage($this->t('The file %file_name has been deleted.', [
            '%file_name' => $this->entity->getFilename(),
          ]));

        return;
      }

      // Mark the file for removal by file_cron().
      $this->entity->setTemporary();
      $this->entity->save();

      $this->messenger()
        ->addMessage($this->t('The file %file_name has been marked for deletion.', [
          '%file_name' => $this->entity->getFilename(),
        ]));
    }
    catch (EntityStorageException | InvalidPluginDefinitionException | PluginNotFoundException $e) {
      $this->messenger()->addError($e->getMessage());
    }
  }

  /**
   * Helper function to get the File Usages view url for the given file.
   *
   * @param int|string $fileEntityId
   *   The File Entity ID.
   *
   * @return string|null
   *   The Url String of the View or FALSE if not possible.
   */
  private function getFileUsagesUrl(int|string $fileEntityId): ?string {
    try {
      $url = new Url('view.files.page_2', ['arg_0' => $fileEntityId]);
      return $url->toString();
    }
    catch (RouteNotFoundException) {
      // Do nothing.
    }

    return FALSE;
  }

}
