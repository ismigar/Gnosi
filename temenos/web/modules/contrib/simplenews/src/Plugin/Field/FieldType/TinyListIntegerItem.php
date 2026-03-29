<?php

namespace Drupal\simplenews\Plugin\Field\FieldType;

use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\options\Plugin\Field\FieldType\ListIntegerItem;

/**
 * Plugin implementation of the 'list_tiny_integer' field type.
 *
 * Based on "list_integer", but using size = 'tiny'. This allows for an update
 * of the status field from boolean.
 *
 * @FieldType(
 *   id = "list_tiny_integer",
 *   label = @Translation("List (tiny integer)"),
 *   description = @Translation("This field stores integer values from a list of allowed 'byte value => label' pairs"),
 *   no_ui = TRUE,
 *   default_widget = "options_select",
 *   default_formatter = "list_default",
 * )
 */
class TinyListIntegerItem extends ListIntegerItem {

  /**
   * {@inheritdoc}
   */
  public static function schema(FieldStorageDefinitionInterface $field_definition) {
    return [
      'columns' => [
        'value' => [
          'type' => 'int',
          'size' => 'tiny',
        ],
      ],
      'indexes' => [
        'value' => ['value'],
      ],
    ];
  }

}
