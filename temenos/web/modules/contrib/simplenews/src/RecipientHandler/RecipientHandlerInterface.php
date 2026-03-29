<?php

namespace Drupal\simplenews\RecipientHandler;

use Drupal\Component\Plugin\PluginInspectionInterface;

/**
 * Interface for Simplenews Recipient Handler Classes.
 */
interface RecipientHandlerInterface extends \Countable, PluginInspectionInterface {

  /**
   * Adds a newsletter issue to the mail spool.
   *
   * @return int
   *   Number of recipients added.
   */
  public function addToSpool();

  /**
   * Returns the elements to add to the settings form for handler settings.
   *
   * @return array
   *   The form elements.
   */
  public function settingsForm();

}
