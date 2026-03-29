<?php

namespace Drupal\crop_image;

use Drupal;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\crop_image\Entity\CropDuplicate;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\file\Plugin\Field\FieldType\FileFieldItemList;

class CropImageManager {

  /**
   * The entity type manager service.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The crop storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $cropStorage;

  /**
   * The crop duplicate storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $cropDuplicateStorage;

  /**
   * The image style storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $imageStyleStorage;

  /**
   * The File storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $fileStorage;

  /**
   * The ImageWidgetCrop general settings.
   *
   * @var \Drupal\Core\Config\ImmutableConfig
   */
  protected $imageWidgetCropSettings;

  /**
   * The config factory used by the config entity query.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected $configFactory;

  /**
   * Constructs a CropImageManager object.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   Entity type manager service.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The configuration factory.
   *
   * @throws \Drupal\Component\Plugin\Exception\InvalidPluginDefinitionException
   * @throws \Drupal\Component\Plugin\Exception\PluginNotFoundException
   */
  public function __construct(EntityTypeManagerInterface $entity_type_manager, ConfigFactoryInterface $config_factory) {
    $this->entityTypeManager = $entity_type_manager;
    $this->cropStorage = $this->entityTypeManager->getStorage('crop');
    $this->cropDuplicateStorage = $this->entityTypeManager->getStorage('crop_duplicate');
    $this->imageStyleStorage = $this->entityTypeManager->getStorage('image_style');
    $this->fileStorage = $this->entityTypeManager->getStorage('file');
    $this->imageWidgetCropSettings = $config_factory->get('image_widget_crop.settings');
    $this->configFactory = $config_factory;
  }

  public function validateCropImages(EntityInterface $entity) {
    $settings = $this->configFactory->get('crop_image.settings');
    if (isset($entity) && $entity instanceof FieldableEntityInterface) {
      $field_crop_images = [];
      // Loop all fields of the entity going to get saved.
      foreach ($entity->getFields() as $entity_fields) {
        // If current field is FileField and use imageWidgetCrop.
        if ($entity_fields instanceof FileFieldItemList) {
          $field_name = $entity_fields->getName();
          $field_crop_images[$field_name] = [];
          /* First loop to get each elements independently in the field values.
          Required if the image field cardinality > 1. */
          $values = $entity_fields->getValue();
          $updated = FALSE;
          foreach ($values as $delta => $crop_elements) {
            $crop_duplicate = NULL;
            foreach ($crop_elements as $crop_element_key => $crop_element) {
              if (is_array($crop_element) && isset($crop_element['crop_wrapper'])) {

                // If file-id key is not available, set it same as parent elements target_id
                if (empty($crop_element['file-id']) && !empty($crop_elements['target_id'])) {
                  $crop_element['file-id'] = $crop_elements['target_id'];
                }

                $file_id = $crop_element['file-id'];
                if (!CropDuplicate::isDuplicate($file_id)) {
                  // Create duplicate image for cropping use.

                  /** @var \Drupal\file_entity\Entity\FileEntity $source_file */
                  $source_file = $this->fileStorage->load($file_id);
                  $params = [
                    'name' => t('Duplicate of @name (@id)', ['@name' => $source_file->label(), '@id' => $file_id]),
                    'source_file_id' => $source_file->id(),
                    'entity_type' => $entity->getEntityTypeId(),
                    'entity_uuid' => $entity->uuid() ?: $entity->id(),
                    'field_name' => $field_name,
                    'field_delta' => $delta,
                  ];
                  $crop_duplicate = CropDuplicate::create($params);
                  $crop_duplicate->save();

                  $duplicate_file = $crop_duplicate->getDuplicateFile();
                  $crop_elements['target_id'] = $duplicate_file->id();
                  foreach ($crop_elements as $key => $crop_element_item) {
                    if (is_array($crop_element_item) && isset($crop_element_item['crop_wrapper'])) {
                      $crop_elements[$key]['file-uri'] = $duplicate_file->getFileUri();
                      $crop_elements[$key]['file-id'] = $duplicate_file->id();
                    }
                  }
                  $values[$delta] = $crop_elements;
                  $updated = TRUE;
                  $field_crop_images[$entity_fields->getName()][] = $duplicate_file->id();
                  $file_id = $duplicate_file->id();
                }
                else {
                  $crop_duplicate = CropDuplicate::getForDuplicateFile($file_id);
                  $entity_unique_id = $entity->uuid() ?: $entity->id();
                  if ($crop_duplicate && !$crop_duplicate->matchUsage($entity->getEntityTypeId(), $entity_unique_id, $field_name)) {
                    // Somehow user seletecd crop images created for somewhere else.
                    $source_file = $crop_duplicate->getSourceFile();
                    $file_id = $source_file->id();
                    $params = [
                      'name' => t('Duplicate of @name (@id)', ['@name' => $source_file->label(), '@id' => $file_id]),
                      'source_file_id' => $source_file->id(),
                      'entity_type' => $entity->getEntityTypeId(),
                      'entity_uuid' => $entity_unique_id,
                      'field_name' => $field_name,
                      'field_delta' => $delta,
                    ];

                    $new_crop_duplicate = CropDuplicate::create($params);
                    $new_crop_duplicate->save();

                    $duplicate_file = $new_crop_duplicate->getDuplicateFile();
                    $crop_elements['target_id'] = $duplicate_file->id();
                    foreach ($crop_elements as $key => $crop_element_item) {
                      if (is_array($crop_element_item) && isset($crop_element_item['crop_wrapper'])) {
                        $crop_elements[$key]['file-uri'] = $duplicate_file->getFileUri();
                        $crop_elements[$key]['file-id'] = $duplicate_file->id();
                      }
                    }
                    $values[$delta] = $crop_elements;
                    $updated = TRUE;
                    $field_crop_images[$entity_fields->getName()][] = $duplicate_file->id();
                  }
                  else {
                    // Save existing crop duplicate images for processing later to determine for deletion.
                    $field_crop_images[$entity_fields->getName()][] = $file_id;
                  }
                }

                if ($settings->get('automatic_crop')) {
                  $file = $this->fileStorage->load($file_id);
                  $image = \Drupal::service('image.factory')->get($file->getFileUri());

                  foreach ($crop_element['crop_wrapper'] as $crop_name => $crop_data) {
                    $crop_type = \Drupal::entityTypeManager()
                      ->getStorage('crop_type')
                      ->load($crop_name);

                    if ($crop_data['crop_container']['values']['crop_applied'] == '0') {
                      if (!empty($crop_type->aspect_ratio)) {
                        list($width_ratio, $height_ratio) = explode(':', $crop_type->aspect_ratio);
                      }
                      else {
                        $width_ratio = $height_ratio = NULL;
                      }

                      // Define properties according to dimensions and ratio.
                      $height = $image->getHeight();
                      $width = $image->getWidth();

                      if (empty($width_ratio) || empty($height_ratio)) {
                        // Take full image if aspect ratio is not defined.
                        $crop_data['crop_container']['values']['height'] = $height;
                        $crop_data['crop_container']['values']['width'] = $width;
                        $crop_data['crop_container']['values']['x'] = 0;
                        $crop_data['crop_container']['values']['y'] = 0;
                      }
                      else {
                        // If it's a wide crop then we use the image width.
                        if ($width / $width_ratio > $height / $height_ratio) {
                          $crop_data['crop_container']['values']['height'] = $height;
                          $crop_data['crop_container']['values']['width'] = $height * $width_ratio / $height_ratio;
                          $crop_data['crop_container']['values']['x'] = ($width - $crop_data['crop_container']['values']['width']) / 2;
                          $crop_data['crop_container']['values']['y'] = 0;
                        }
                        else {
                          $crop_data['crop_container']['values']['width'] = $width;
                          $crop_data['crop_container']['values']['height'] = $width * $height_ratio / $width_ratio;
                          $crop_data['crop_container']['values']['x'] = 0;
                          $crop_data['crop_container']['values']['y'] = ($height - $crop_data['crop_container']['values']['height']) / 2;
                        }
                      }

                      $crop_data['crop_container']['values']['crop_applied'] = 1;
                      // $element['crop_wrapper'][$type]['crop_container']['values']['crop_applied']['#value'] = 1;
                      // $edit = TRUE;

                      $values[$delta][$crop_element_key]['crop_wrapper'][$crop_name] = $crop_data;
                      $updated = TRUE;
                    }
                  }
                }

              }
            }
          }

          if ($updated) {
            $entity_fields->setValue($values);
          }
        }
      }
      if (!$entity->isNew()) {
        $original = $entity->original;
        foreach ($field_crop_images as $field_name => $current_duplicate_file_ids) {
          $original_duplicate_file_ids = [];
          foreach ($original->$field_name->getValue() as $item) {
            $original_duplicate_file_ids[] = $item['target_id'];
          }
          $removed_duplicate_files = array_diff($original_duplicate_file_ids, $current_duplicate_file_ids);
          foreach ($removed_duplicate_files as $fid) {
            $crop_duplicate = CropDuplicate::getForDuplicateFile($fid);
            $entity_unique_id = $entity->uuid() ?: $entity->id();
            if ($crop_duplicate && $crop_duplicate->matchUsage($entity->getEntityTypeId(), $entity_unique_id, $field_name)) {
              // Make sure we are deleting crop duplicates by this entity.
              $crop_duplicate->delete();
            }
          }
        }
      }
    }
  }

  public function removeCropImages(EntityInterface $entity) {
    if (isset($entity) && $entity instanceof FieldableEntityInterface) {
      foreach (CropDuplicate::getCropDuplicatesForEntity($entity) as $crop_duplicate) {
        $crop_duplicate->delete();
      }
    }
  }

  public function moveOriginalFile(EntityInterface $entity) {

    if (isset($entity) && $entity instanceof FieldableEntityInterface) {
      $stream_wrapper_manager = \Drupal::service('stream_wrapper_manager');
      /** @var \Drupal\Core\File\FileSystemInterface */
      $file_system = \Drupal::service('file_system');
      /** @var \Drupal\file\FileRepositoryInterface $file_repository */
      $file_repository = \Drupal::service('file.repository');

      $field_crop_images = [];
      // Loop all fields of the entity going to get saved.
      foreach ($entity->getFields() as $entity_fields) {
        // If current field is FileField and use imageWidgetCrop.
        if ($entity_fields instanceof FileFieldItemList) {
          $field_name = $entity_fields->getName();
          $field_crop_images[$field_name] = [];
          /* First loop to get each elements independently in the field values.
          Required if the image field cardinality > 1. */
          $values = $entity_fields->getValue();
          $updated = FALSE;
          foreach ($values as $delta => $crop_elements) {
            /** @var \Drupal\crop_image\Entity\CropDuplicate $crop_duplicate */
            $crop_duplicate = CropDuplicate::getForDuplicateFile($crop_elements['target_id']);
            $entity_unique_id = $entity->uuid() ?: $entity->id();
            if ($crop_duplicate && $crop_duplicate->matchUsage($entity->getEntityTypeId(), $entity_unique_id, $field_name)) {
              $source_file = $crop_duplicate->getSourceFile();
              $duplicate_file = $crop_duplicate->getDuplicateFile();

              $source_dirname = $file_system->dirname($source_file->getFileUri());
              $duplicate_dirname = $file_system->dirname($duplicate_file->getFileUri());

              $source_filename = $source_file->getFileName();
              // It will be FALSE if it failed to identify the original filename part.
              $original_filename_part_in_duplicate = $crop_duplicate->getOriginalFileNamePart();

              $directory_changed = $source_dirname != $duplicate_dirname;
              $filename_changed = $original_filename_part_in_duplicate !== FALSE && $source_filename != $original_filename_part_in_duplicate;
              $new_file_name = $original_filename_part_in_duplicate !== FALSE ? $original_filename_part_in_duplicate : $source_filename;

              if ($directory_changed || $filename_changed) {
                // By default, duplicate file will be in same directory as original.
                // First condition checks, if the duplicate has been relocated by some other code, eg: filefield_paths module.
                // So, we will move the original file as well to act as if orignal file will be moved itself
                // if crop_image is inactive.
                // Second condition checks if "cleaning" has been applied to filename. So, it needs to do same for original.

                $destination = $file_system->createFilename($new_file_name, $duplicate_dirname);
                $source_file = $file_repository->move($source_file, $destination);
              }
            }
          }

        }
      }
    }
  }
}
