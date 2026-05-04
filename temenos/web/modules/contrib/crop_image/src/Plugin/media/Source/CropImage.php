<?php

namespace Drupal\crop_image\Plugin\media\Source;

use Drupal\media\MediaInterface;
use Drupal\media\Plugin\media\Source\Image;
use Drupal\crop_image\Entity\CropDuplicate;

/**
 * Image entity media source.
 *
 * @see \Drupal\Core\Image\ImageInterface
 *
 * @MediaSource(
 *   id = "crop_image",
 *   label = @Translation("Crop Image"),
 *   description = @Translation("Use local images for reusable media. Use this as source if image field is set to use crop image widget."),
 *   allowed_field_types = {"image"},
 *   default_thumbnail_filename = "no-thumbnail.png",
 *   thumbnail_alt_metadata_attribute = "thumbnail_alt_value"
 * )
 */
class CropImage extends Image {

  /**
   * {@inheritdoc}
   */
  public function getMetadata(MediaInterface $media, $name) {
    // Get the file and image data.
    /** @var \Drupal\file\FileInterface $file */
    $file = $media->get($this->configuration['source_field'])->entity;
    // If the source field is not required, it may be empty.
    if (!$file) {
      return parent::getMetadata($media, $name);
    }

    switch ($name) {
      case static::METADATA_ATTRIBUTE_NAME_WITHOUT_EXT:
        $crop_duplicate = CropDuplicate::getForDuplicateFile($file->id());
        if ($crop_duplicate) {
          $source_file = $crop_duplicate->getSourceFile();
        }
        else {
          $source_file = $file;
        }
        return preg_replace('/\.[^.\s]+$/', '', $source_file->getFilename());
    }

    return parent::getMetadata($media, $name);
  }

  /**
   * {@inheritdoc}
   */
  public function getPluginDefinition() {
    $plugin_definition = parent::getPluginDefinition();
    if (\Drupal::moduleHandler()->moduleExists('media_library') && !isset($plugin_definition['forms']['media_library_add'])) {
      $plugin_definition['forms']['media_library_add'] = 'Drupal\media_library\Form\FileUploadForm';
    }
    return $plugin_definition;
  }

}
