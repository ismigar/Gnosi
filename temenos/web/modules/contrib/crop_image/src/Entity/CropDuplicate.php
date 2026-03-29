<?php

namespace Drupal\crop_image\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\file\Entity\File;
use Drupal\user\EntityOwnerTrait;
use Drupal\crop_image\CropDuplicateInterface;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Entity\EntityInterface;

/**
 * Defines the crop duplicate entity class.
 *
 * @ContentEntityType(
 *   id = "crop_duplicate",
 *   label = @Translation("Crop Duplicate"),
 *   label_collection = @Translation("Crop duplicates"),
 *   label_singular = @Translation("crop duplicate"),
 *   label_plural = @Translation("crop duplicates"),
 *   label_count = @PluralTranslation(
 *     singular = "@count crop duplicate",
 *     plural = "@count crop duplicates"
 *   ),
 *   handlers = {
 *     "storage" = "Drupal\crop_image\CropDuplicateStorage",
 *     "storage_schema" = "Drupal\crop_image\CropDuplicateStorageSchema",
 *     "access" = "Drupal\crop_image\CropDuplicateAccessControlHandler",
 *     "views_data" = "Drupal\crop_image\CropDuplicateViewsData",
 *   },
 *   base_table = "crop_duplicate",
 *   entity_keys = {
 *     "id" = "cdid",
 *     "label" = "name",
 *     "langcode" = "langcode",
 *     "uuid" = "uuid",
 *     "uid" = "uid",
 *     "owner" = "uid"
 *   }
 * )
 */
class CropDuplicate extends ContentEntityBase implements CropDuplicateInterface {

  use EntityChangedTrait;
  use EntityOwnerTrait;

  /**
   * Reg express pattern to match for duplicate files name.
   *
   * @var string
   */
  const COPY_FILE_NAME_PATTERN = '/^crop-duplicate-\d+-for-(.+)/';

  /**
   * {@inheritdoc}
   */
  public function getSourceFile() {
    return File::load($this->get('source_file_id')->target_id);
  }

  /**
   * {@inheritdoc}
   */
  public function getDuplicateFile() {
    return File::load($this->get('duplicate_file_id')->target_id);
  }

  /**
   * {@inheritdoc}
   */
  public static function preCreate(EntityStorageInterface $storage, array &$values) {
    parent::preCreate($storage, $values);
    // Automatically create the duplicate file from the source.
    if (!isset($values['duplicate_file_id']) && isset($values['source_file_id'])) {
      $source_file = File::load($values['source_file_id']);
      if ($source_file) {
        /** @var \Drupal\file\FileRepositoryInterface $file_repository */
        $file_repository = \Drupal::service('file.repository');

        /** @var \Drupal\Core\File\FileSystemInterface */
        $file_system = \Drupal::service('file_system');

        $dirname = $file_system->dirname($source_file->getFileUri());
        $new_filename = static::getNextFilename($source_file);
        $destination = $file_system->createFilename($new_filename, $dirname);

        $duplicate_file = $file_repository->copy($source_file, $destination, FileSystemInterface::EXISTS_RENAME);

        $moduleHandler = \Drupal::service('module_handler');
        if ($moduleHandler->moduleExists('filefield_paths')) {
          $duplicate_file->origname = $duplicate_file->getFilename();
        }
        $duplicate_file->save();
        $values['duplicate_file_id'] = $duplicate_file->id();
      }
    }
    if (empty($values['uid'])) {
      $values['uid'] = \Drupal::currentUser()->id();
    }
  }

  /**
   * Function helping to find suitable filename for the image being duplicated.
   *
   * @param Drupal\file\Entity\File $source_file
   *
   * @return string
   */
  public static function getNextFilename($source_file) {
    $info = pathinfo($source_file->getFileUri());
    $counter = 1;
    do {
      // Please make sure to match this with pattern self::COPY_FILE_NAME_PATTERN
      $new_filename = 'crop-duplicate-' . $counter . '-for-' . $info['basename'];
      $counter++;
    } while(\Drupal::database()->query("SELECT fid FROM {file_managed} WHERE filename = :filename ", [
      ':filename' => $new_filename,
    ])->fetchField());

    return $new_filename;
  }

  /**
   * {@inheritdoc}
   */
  public function postSave(EntityStorageInterface $storage, $update = TRUE) {
    parent::postSave($storage, $update);

    if (!$update) {
      $source_file = File::load($this->get('source_file_id')->target_id);
      $duplicate_file = File::load($this->get('duplicate_file_id')->target_id);

      \Drupal::service('file.usage')->add($source_file, 'crop_image', $this->getEntityTypeId(), $this->id());
      \Drupal::service('file.usage')->add($duplicate_file, 'crop_image', $this->getEntityTypeId(), $this->id());
    }

  }

  /**
   * {@inheritdoc}
   */
  public function delete() {
    $source_file = File::load($this->get('source_file_id')->target_id);
    $duplicate_file = File::load($this->get('duplicate_file_id')->target_id);

    \Drupal::service('file.usage')->delete($source_file, 'crop_image', $this->getEntityTypeId(), $this->id());
    \Drupal::service('file.usage')->delete($duplicate_file, 'crop_image', $this->getEntityTypeId(), $this->id());

    // This entity copied the original image file.
    // So, it deletes the copy image when getting deleted.
    $duplicate_file->delete();

    parent::delete();
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type) {
    /** @var \Drupal\Core\Field\BaseFieldDefinition[] $fields */
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields += static::ownerBaseFieldDefinitions($entity_type);

    $fields['cdid']->setLabel(t('Crop Duplicate ID'))
      ->setDescription(t('The crop duplicate ID.'));

    $fields['name'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Name'))
      ->setDescription(t('Name of the duplicate for a clue.'));

    $fields['uuid']->setDescription(t('The crop duplicate UUID.'));

    $fields['langcode']->setLabel(t('Language code'))
      ->setDescription(t('The crop duplicate language code.'));

    $fields['uid']
      ->setDescription(t('The user ID of the crop duplicate.'));

    $fields['source_file_id'] = BaseFieldDefinition::create('entity_reference')
        ->setLabel(t('Source file ID'))
        ->setSetting('target_type', 'file')
        ->setDescription(t('The file ID of source file.'));

    $fields['duplicate_file_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('Duplicate file ID'))
      ->setSetting('target_type', 'file')
      ->setDescription(t('The file ID of duplicate file.'));

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(t('Created'))
      ->setDescription(t('The timestamp that the file was created.'));

    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(t('Changed'))
      ->setDescription(t('The timestamp that the file was last changed.'));

    $fields['entity_type'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Target Entity Type'))
      ->setDescription(t('Type of the entity that uses the duplicate.'));

    $fields['entity_uuid'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Target Entity UUID'))
      ->setDescription(t('UUID of the entity that uses the duplicate.'));

    $fields['field_name'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Target Field Name'))
      ->setDescription(t('Name of the field in entity that use the duplicate.'));

    $fields['field_delta'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Field Delta in the Field'))
      ->setDescription(t('Delta of field item Name of the field in entity that use the duplicate.'));

    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public static function getDefaultEntityOwner() {
    return NULL;
  }

  public static function isDuplicate($fid) {
    $crop_duplicates = \Drupal::entityTypeManager()->getStorage('crop_duplicate')
      ->loadByProperties(['duplicate_file_id' => $fid]);
    return !empty($crop_duplicates);
  }

  public static function getForDuplicateFile($fid) {
    $crop_duplicates = \Drupal::entityTypeManager()->getStorage('crop_duplicate')
      ->loadByProperties(['duplicate_file_id' => $fid]);
    return reset($crop_duplicates);
  }

  public function matchUsage($entit_type, $entity_uuid, $feld_name, $field_delta = NULL) {
    $match = $this->get('entity_type')->value == $entit_type
      && $this->get('entity_uuid')->value == $entity_uuid
      && $this->get('field_name')->value == $feld_name;
    if (isset($field_delta)) {
      $match = $match && $this->get('field_delta')->value == $field_delta;
    }
    return $match;
  }

  public static function getCropDuplicatesForEntity(EntityInterface $entity) {
    $crop_duplicates = \Drupal::entityTypeManager()
      ->getStorage('crop_duplicate')
      ->loadByProperties([
        'entity_type' => $entity->getEntityTypeId(),
        'entity_uuid' => $entity->uuid() ?: $entity->id(),
      ]);

    return $crop_duplicates;
  }

  /**
   * @see static::getNextFilename()
   * @see self::COPY_FILE_NAME_PATTERN
   */
  public function getOriginalFileNamePart() {
    $duplicate_file = $this->getDuplicateFile();

    $moduleHandler = \Drupal::service('module_handler');
    if ($moduleHandler->moduleExists('filefield_paths')) {
      $file_name = $duplicate_file->origname->value;
    }
    else {
      $file_name = $duplicate_file->getFileName();
    }

    preg_match(self::COPY_FILE_NAME_PATTERN, $file_name, $match);
    if ($match) {
      return $match[1];
    }
    // Indicates, original filename could not be identified.
    return FALSE;
  }

}
