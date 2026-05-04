<?php

namespace Drupal\crop_image;

use Drupal\views\EntityViewsData;

/**
 * Provides views data for the file entity type.
 */
class CropDuplicateViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData() {
    $data = parent::getViewsData();

    $data['crop_duplicate']['cdid']['filter']['allow empty'] = TRUE;

    $data['crop_duplicate']['table']['join'] = [
      'file_managed' => [
        'field' => 'duplicate_file_id',
        'left_field' => 'fid',
      ],
    ];

    return $data;
  }

}
