<?php

namespace Drupal\crop_image\Plugin\Action;

use Drupal\views_bulk_operations\Action\ViewsBulkOperationsActionBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\crop\Entity\Crop;
use Drupal\file\Entity\File;
use Drupal\Core\Plugin\PluginFormInterface;

/**
 * Delete entity action with default confirmation form.
 *
 * @Action(
 *   id = "crop_image_generate_default_crop",
 *   label = @Translation("Generate default crop"),
 *   type = "",
 *   confirm = TRUE,
 * )
 */
class GenerateDefaultCropAction extends ViewsBulkOperationsActionBase implements PluginFormInterface {

  /**
   * {@inheritdoc}
   */
  public function execute(File $file = NULL) {
    // if (strpos($file->getMimeType(), 'image') !== 0) {
    //   return FALSE;
    // }

    $messages = [];

    // Check first that the file is an image.
    $image_factory = \Drupal::service('image.factory');
    $image = $image_factory->get($file->getFileUri());

    if (!$image->isValid()) {
      $messages[] = $this->t('File not existing or not an image.');
    }
    else {

      $crop_types = array_filter($this->configuration['crop_types']);

      if (empty($crop_types)) {
        $crop_types = array_keys($this->configuration['crop_types']);
      }

      $crop_storage = \Drupal::service('entity_type.manager')->getStorage('crop');

      foreach ($crop_types as $crop_type_name) {
        $crop_type = \Drupal::entityTypeManager()
            ->getStorage('crop_type')
            ->load($crop_type_name);

        if (!Crop::cropExists($file->getFileUri(), $crop_type_name)) {
          list($width_ratio, $height_ratio) = explode(':', $crop_type->aspect_ratio);

          // Define properties according to dimensions and ratio.
          $height = $image->getHeight();
          $width = $image->getWidth();

          if (empty($width_ratio) || empty($height_ratio)) {
            // Take full image if aspect ratio is not defined.
            $crop_height = $height;
            $crop_width = $width;
            $crop_x = 0;
            $crop_y = 0;
          }
          else {
            // If it's a wide crop then we use the image width.
            if ($width / $width_ratio > $height / $height_ratio) {
              $crop_height = $height;
              $crop_width = $height * $width_ratio / $height_ratio;
              $crop_x = ($width - $crop_width) / 2;
              $crop_y = 0;
            }
            else {
              $crop_width = $width;
              $crop_height = $width * $height_ratio / $width_ratio;
              $crop_x = 0;
              $crop_y = ($height - $crop_height) / 2;
            }
          }

          $values = [
            'type' => $crop_type->id(),
            'entity_id' => $file->id(),
            'entity_type' => $file->getEntityTypeId(),
            'uri' => $file->getFileUri(),
            'x' => $crop_x,
            'y' => $crop_y,
            'width' => $crop_width,
            'height' => $crop_height,
          ];

          // This is somehow required.
          // See ImageWidgetCropManager::getCropOriginalDimension()
          $values['x'] = (int) round($values['x'] + ($values['width'] / 2));
          $values['y'] = (int) round($values['y'] + ($values['height'] / 2));

          // $crop = Crop::create($values);
          // $crop->save();

          /** @var \Drupal\crop\CropInterface $crop */
          $crop = $crop_storage->create($values);
          $crop->save();

          $messages[] = $this->t('Created crop "@crop_type".', ['@crop_type' => $crop_type->label()]);
        }
        else {
          $messages[] = $this->t('Crop "@crop_type" already exists.', ['@crop_type' => $crop_type->label()]);
        }
      }
    }

    return $this->t('@filename: ', ['@filename' => $file->label()]) . implode(' ', $messages);
  }

  /**
   * {@inheritdoc}
   */
  public function access($object, AccountInterface $account = NULL, $return_as_object = FALSE) {
    // $access = $object->access('delete', $account, TRUE);
    // return $return_as_object ? $access : $access->isAllowed();
    return TRUE;
  }

  /**
   * Form allowig to choose crop types
   *
   * @param array $form
   *   Form array.
   * @param Drupal\Core\Form\FormStateInterface $form_state
   *   The form state object.
   *
   * @return array
   *   The configuration form.
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $options = [];
    $node_types = \Drupal::service('entity_type.manager')->getStorage('crop_type')->loadMultiple();
    foreach ($node_types as $type) {
      $options[$type->id()] = $type->label();
    }
    $form['crop_types'] = [
      '#title' => $this->t('Crop Types'),
      '#type' => 'checkboxes',
      '#default_value' => $form_state->getValue('crop_types') ?? [],
      '#options' => $options,
      '#description' => $this->t('Select crop type(s) to generate default crop. Selecting none is same as selecting all.')
    ];
    return $form;
  }

  // /**
  //  * Submit handler for the action configuration form.
  //  *
  //  * If not implemented, the cleaned form values will be
  //  * passed directly to the action $configuration parameter.
  //  *
  //  * @param array $form
  //  *   Form array.
  //  * @param Drupal\Core\Form\FormStateInterface $form_state
  //  *   The form state object.
  //  */
  // public function submitConfigurationForm(array &$form, FormStateInterface $form_state) {
  //   $this->configuration['crop_types'] = $form_state->getValue('crop_types');
  // }

}
