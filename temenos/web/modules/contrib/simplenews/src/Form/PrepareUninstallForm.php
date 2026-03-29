<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Removes fields and data used by Simplenews.
 */
class PrepareUninstallForm extends FormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_admin_settings_prepare_uninstall';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form['simplenews'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Prepare uninstall'),
      '#description' => $this->t('When clicked all Simplenews data (content, fields) will be removed.'),
    ];

    $form['simplenews']['prepare_uninstall'] = [
      '#type' => 'submit',
      '#value' => $this->t('Delete Simplenews data'),
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $batch = [
      'title' => $this->t('Deleting subscribers'),
      'operations' => [
        [
          [__CLASS__, 'deleteEntities'], ['simplenews_subscriber'],
        ],
        [
          [__CLASS__, 'deleteEntities'], ['simplenews_subscriber_history'],
        ],
        [
          [__CLASS__, 'removeFields'], [],
        ],
        [
          [__CLASS__, 'purgeFieldData'], [],
        ],
      ],
      'progress_message' => $this->t('Deleting Simplenews data... Completed @percentage% (@current of @total).'),
    ];
    batch_set($batch);

    $this->messenger()->addMessage($this->t('Simplenews data has been deleted.'));
  }

  /**
   * Deletes entities of the specified type.
   *
   * @param string $type
   *   Entity type.
   * @param array|\ArrayAccess $context
   *   An array of contextual key/values.
   */
  public static function deleteEntities($type, &$context) {
    $storage = \Drupal::entityTypeManager()->getStorage($type);
    $ids = $storage->getQuery()->range(0, 100)->accessCheck(FALSE)->execute();
    if ($entities = $storage->loadMultiple($ids)) {
      $storage->delete($entities);
    }
    $context['finished'] = (int) count($ids) < 100;
  }

  /**
   * Removes Simplenews fields.
   */
  public static function removeFields() {
    $field_config_storage = \Drupal::entityTypeManager()->getStorage('field_config');
    $simplenews_fields_ids = $field_config_storage->getQuery()
      ->condition('field_type', 'simplenews_', 'STARTS_WITH')->execute();
    $simplenews_fields = $field_config_storage->loadMultiple($simplenews_fields_ids);

    $field_config_storage->delete($simplenews_fields);
  }

  /**
   * Purges a field data.
   */
  public static function purgeFieldData() {
    do {
      field_purge_batch(1000);
      $properties = [
        'deleted' => TRUE,
        'include_deleted' => TRUE,
      ];
      $fields = \Drupal::entityTypeManager()
        ->getStorage('field_config')
        ->loadByProperties($properties);
    } while ($fields);
  }

}
