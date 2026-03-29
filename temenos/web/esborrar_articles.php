#!/usr/bin/env php
<?php

use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

// Mostra errors
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Autoload
require_once '/home/ismigar/webapps/web/vendor/autoload.php';
require_once '/home/ismigar/webapps/web/web/autoload.php';

// Crear el request i arrencar Drupal
$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, require '/home/ismigar/webapps/web/web/autoload.php', 'prod');
$kernel->boot();

// Inicia sessió com a admin
$account = \Drupal\user\Entity\User::load(1);
\Drupal::currentUser()->setAccount($account);

// Obté els ID dels nodes
$nids = \Drupal::entityQuery('node')
  ->condition('type', 'article')
  ->accessCheck(FALSE)
  ->execute();

// Utilitza el servei d'storage, més robust
$storage = \Drupal::entityTypeManager()->getStorage('node');
$nodes = $storage->loadMultiple($nids);
$storage->delete($nodes);

echo count($nodes) . " nodes de tipus article esborrats.\n";

// Finalitza
$kernel->terminate($request, new \Symfony\Component\HttpFoundation\Response());
