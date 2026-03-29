<?php

namespace Drupal\crop_image;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\EntityOwnerInterface;
use Drupal\Core\Entity\EntityChangedInterface;

/**
 * Defines getter and setter methods for crop duplicate entity base fields.
 */
interface CropDuplicateInterface extends ContentEntityInterface, EntityChangedInterface, EntityOwnerInterface {

  /**
   * Returns the original file object
   *
   * @return \Drupal\file\Entity\File
   *   Original file object
   */
  public function getSourceFile();

  /**
   * Returns the original file object
   *
   * @return \Drupal\file\Entity\File
   *   Original file object
   */
  public function getDuplicateFile();

  /**
   * Checks whether the given file is duplicate created for crop purpose.
   * 
   * @param int
   *  File ID
   *
   * @return boolean
   */
  public static function isDuplicate($fid);

}
