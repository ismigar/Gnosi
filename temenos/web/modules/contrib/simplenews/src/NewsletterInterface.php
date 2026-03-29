<?php

namespace Drupal\simplenews;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Provides an interface defining a simplenews newsletter entity.
 */
interface NewsletterInterface extends ConfigEntityInterface {

  /**
   * Checks if the newsletter is accessible for the current user.
   *
   * @return TRUE if the newsletter is accessible.
   */
  public function isAccessible();

}
