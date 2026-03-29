<?php

/**
 * @file
 * Views integration for the realname module.
 */

/**
 * Implements hook_views_data().
 */
function realname_views_data() {
  $data['realname']['table']['group'] = t('Realname');
  $data['realname']['table']['join'] = [
    'users_field_data' => [
      'left_field' => 'uid',
      'field' => 'uid',
    ],
  ];

  $data['realname']['realname'] = [
    'title' => t('Real name'),
    'help' => t("The user's real name."),
    'field' => [
      'id' => 'standard',
      'click sortable' => TRUE,
    ],
    'sort' => [
      'id' => 'standard',
    ],
    'argument' => [
      'id' => 'string',
    ],
    'filter' => [
      'id' => 'string',
      'title' => t('Name'),
      'help' => t("The user's real name. This filter does not check if the user exists and allows partial matching. Does not utilize autocomplete."),
    ],
  ];

  return $data;
}
