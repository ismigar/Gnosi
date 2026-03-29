<?php

use Drupal\Core\Config\ConfigFactoryInterface;

/** @var ConfigFactoryInterface $factory */
$factory = \Drupal::configFactory();

/** Edita aquí els editors que vols normalitzar */
$editors = [
  'editor.editor.full_html',
  // afegeix-hi si vols:
  // 'editor.editor.basic_html',
  // 'editor.editor.webform_default',
];

foreach ($editors as $name) {
  $e = $factory->getEditable($name);

  // Defineix un toolbar SA i IMCE operatiu (pots afegir/imce_selector si vols)
  $items = [
    'undo','redo','heading','bold','italic','link',
    'imce_image','imce_link',
    'bulletedList','numberedList','blockQuote','codeBlock',
    'insertTable','removeFormat',
  ];

  $e->set('editor', 'ckeditor5');
  $e->set('settings', [
    'toolbar' => ['items' => $items],
    'image_upload' => ['status' => false],
  ]);

  $e->save();
  print "fixed $name\n";
}
