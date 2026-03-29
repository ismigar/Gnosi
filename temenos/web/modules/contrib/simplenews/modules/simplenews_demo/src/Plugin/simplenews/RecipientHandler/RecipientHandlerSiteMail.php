<?php

namespace Drupal\simplenews_demo\Plugin\simplenews\RecipientHandler;

use Drupal\simplenews\Plugin\simplenews\RecipientHandler\RecipientHandlerBase;

/**
 * Recipient Handler that sends to the main site mail.
 *
 * @RecipientHandler(
 *   id = "simplenews_site_mail",
 *   title = @Translation("Send to main site mail")
 * )
 */
class RecipientHandlerSiteMail extends RecipientHandlerBase {

  /**
   * {@inheritdoc}
   */
  public function addToSpool() {
    $subscriber_data = ['mail' => \Drupal::config('system.site')->get('mail')];
    $this->addArrayToSpool('data', [$subscriber_data]);
    return 1;
  }

  /**
   * {@inheritdoc}
   */
  protected function doCount() {
    return 1;
  }

}
