<?php
namespace Drupal\n8n_helper\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class TranslationController extends ControllerBase
{
  public function addTranslation(Request $request)
  {
    $data = json_decode($request->getContent(), TRUE);
    if (!$data || empty($data['uuid']) || empty($data['langcode'])) {
      return new JsonResponse(['error' => 'Dades periudades o falta UUID/langcode'], 400);
    }

    $uuid = $data['uuid'];
    $langcode = $data['langcode'];
    $fields = $data['fields'] ?? [];

    $nodes = \Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['uuid' => $uuid]);
    $node = reset($nodes);
    if (!$node)
      return new JsonResponse(['error' => 'Node no trobat'], 404);

    try {
      $source_lang = $node->language()->getId();

      // Si la traducció existeix o és l'idioma original, l'obtenim.
      if ($source_lang === $langcode) {
        $node_trans = $node;
        $message = 'Editing source language';
      } elseif ($node->hasTranslation($langcode)) {
        $node_trans = $node->getTranslation($langcode);
        $message = 'Translation updated';
      } else {
        $node_trans = $node->addTranslation($langcode);
        $message = 'Translation created';
      }

      foreach ($fields as $field_name => $field_value) {
        // Ignorem camps de sistema per evitar errors
        if (in_array($field_name, ['langcode', 'language', 'content_translation_source']))
          continue;

        if ($node_trans->hasField($field_name)) {
          $node_trans->set($field_name, $field_value);
        }
      }

      $node_trans->setPublished(TRUE);
      $node_trans->save();

      return new JsonResponse([
        'message' => $message,
        'nid' => $node->id(),
        'uuid' => $uuid,
        'langcode' => $langcode,
        'source_lang' => $source_lang
      ], 200);
    } catch (\Exception $e) {
      return new JsonResponse([
        'error' => $e->getMessage(),
        'node_lang' => $node->language()->getId(),
        'requested_lang' => $langcode,
        'trace' => substr($e->getTraceAsString(), 0, 500)
      ], 500);
    }
  }
}