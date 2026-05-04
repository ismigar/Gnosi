<?php

namespace Drupal\simplenews;

use Drupal\views\EntityViewsData;

/**
 * Provides the views data for the subscriber entity type.
 */
class SubscriberViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData() {
    $data = parent::getViewsData();

    // @todo Username obtained through custom plugin due to core issue.
    $data['simplenews_subscriber']['user_name'] = [
      'real field' => 'uid',
      'field' => [
        'title' => $this->t('Username'),
        'help' => $this->t("Provide a simple link to the subscriber's user account."),
        'id' => 'simplenews_user_name',
      ],
    ];

    $data['simplenews_subscriber']['status']['filter'] = [
      'id' => 'in_operator',
      'options callback' => 'simplenews_subscriber_status_options',
    ];

    $data['simplenews_subscriber__subscriptions']['subscriptions_target_id']['filter'] = [
      'id' => 'in_operator',
      'options callback' => 'simplenews_newsletter_list',
      'allow empty' => TRUE,
    ];

    return $data;
  }

}
