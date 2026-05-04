<?php

/**
 * @file
 * Views interface for simplenews.
 */

use Drupal\field\FieldStorageConfigInterface;

/**
 * Implements hook_field_views_data().
 */
function simplenews_field_views_data(FieldStorageConfigInterface $field_storage) {
  $data = views_field_default_views_data($field_storage);
  foreach ($data as $table_name => $table_data) {
    // Add the filter for newsletters.
    $data[$table_name][$field_storage->getName() . '_target_id']['filter']['id'] = 'in_operator';
    $data[$table_name][$field_storage->getName() . '_target_id']['filter']['options callback'] = 'simplenews_newsletter_list';
  }
  return $data;
}

/**
 * Implements hook_views_data().
 */
function simplenews_views_data() {

  $data['node']['send_status'] = [
    'real field' => 'nid',
    'field' => [
      'title' => t('Send status'),
      'help' => t('Send status of the newsletter.'),
      'id' => 'simplenews_send_status',
    ],
    'group' => t('Content'),
  ];

  /* ------------ Definitions for Simplenews mailspool ---------------------- */

  $data['simplenews_mail_spool']['table'] = [
    'base' => [
      'field' => 'msid',
      'title' => t('Simplenews mailspool'),
      'help' => t('Spool for temporary storage of newsletter emails.'),
      'weight' => 10,
      'database' => 'default',
    ],
    'group' => t('Simplenews spool'),
  ];

  $data['simplenews_mail_spool']['msid'] = [
    'title' => t('Ms ID'),
    'help' => t('The primary identifier for a mail spool record.'),
    'field' => [
      'id' => 'numeric',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'numeric',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'numeric',
    ],
    'sort' => [
      'id' => 'standard',
    ],
  ];

  $data['simplenews_mail_spool']['entity_id'] = [
    'title' => t('Node ID'),
    'help' => t('The {node}.nid of this newsletter.'),
    'field' => [
      'id' => 'numeric',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'numeric',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'numeric',
    ],
    'sort' => [
      'id' => 'standard',
    ],
    'relationship' => [
      'id' => 'standard',
      'base' => 'node',
      'base field' => 'nid',
      'label' => t('Node'),
    ],
  ];

  $data['simplenews_mail_spool']['newsletter_id'] = [
    'title' => t('Newsletter ID'),
    'help' => t('The newsletter_id this newsletter issue belongs to.'),
    'field' => [
      'id' => 'numeric',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'numeric',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'numeric',
    ],
    'sort' => [
      'id' => 'standard',
    ],
    'relationship' => [
      'id' => 'standard',
      'base' => 'simplenews_newsletter',
      'base field' => 'newsletter_id',
      'label' => t('Newsletter'),
    ],
  ];

  $data['simplenews_mail_spool']['snid'] = [
    'title' => t('Subscriber ID'),
    'help' => t('The {simplenews_subscriber}.snid foreign key for this spool'),
    'field' => [
      'id' => 'numeric',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'numeric',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'numeric',
    ],
    'sort' => [
      'id' => 'standard',
    ],
    'relationship' => [
      'id' => 'standard',
      'base' => 'simplenews_subscriber',
      'base field' => 'snid',
      'label' => t('Subscriber'),
    ],
  ];

  $data['simplenews_mail_spool']['status'] = [
    'title' => t('Sent status'),
    'help' => t('The sent status of the email (0 = hold, 1 = pending, 2 = done, 3 = in progress, 4 = skipped, 5 = failed).'),
    'field' => [
      'id' => 'numeric',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'numeric',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'numeric',
    ],
    'sort' => [
      'id' => 'standard',
    ],
  ];

  $data['simplenews_mail_spool']['timestamp'] = [
    'title' => t('Timestamp'),
    'help' => t('The time status was set or changed.'),
    'field' => [
      'id' => 'date',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'date',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'date',
    ],
    'sort' => [
      'id' => 'date',
    ],
  ];

  $data['simplenews_mail_spool']['data'] = [
    'title' => t('Data'),
    'help' => t('A serialized array of name value pairs that define a temporary subscriber.'),
    'field' => [
      'id' => 'standard',
      'click sortable' => TRUE,
    ],
    'filter' => [
      'id' => 'string',
      'allow empty' => TRUE,
    ],
    'argument' => [
      'id' => 'string',
    ],
    'sort' => [
      'id' => 'standard',
    ],
  ];

  return $data;
}
