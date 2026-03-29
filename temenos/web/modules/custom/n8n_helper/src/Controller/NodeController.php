<?php
namespace Drupal\n8n_helper\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Controller per actualitzar nodes des de n8n sense necessitar PATCH.
 * 
 * Endpoint: POST /custom/node-helper/update
 * Payload: {
 *   "uuid": "node-uuid",
 *   "type": "article|disseny|recurs|col_laboradora",
 *   "attributes": { "title": "...", "body": {...} },
 *   "relationships": { "field_image": {...}, "field_tags": {...} }
 * }
 */
class NodeController extends ControllerBase
{
  public function updateNode(Request $request)
  {
    $data = json_decode($request->getContent(), TRUE);
    
    // Validació bàsica
    if (!$data || empty($data['uuid'])) {
      return new JsonResponse(['error' => 'Falta UUID del node'], 400);
    }

    $uuid = $data['uuid'];
    $attributes = $data['attributes'] ?? [];
    $relationships = $data['relationships'] ?? [];

    // Carregar el node per UUID
    $nodes = \Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['uuid' => $uuid]);
    $node = reset($nodes);
    
    if (!$node) {
      return new JsonResponse(['error' => 'Node no trobat amb UUID: ' . $uuid], 404);
    }

    try {
      // Actualitzar atributs
      foreach ($attributes as $field_name => $field_value) {
        // Ignorar camps protegits
        if (in_array($field_name, ['uuid', 'nid', 'vid', 'langcode', 'type'])) {
          continue;
        }
        
        if ($node->hasField($field_name)) {
          $node->set($field_name, $field_value);
        }
      }

      // Actualitzar relacions (imatge, tags, etc.)
      foreach ($relationships as $field_name => $relation_data) {
        if (!$node->hasField($field_name)) {
          continue;
        }
        
        // Format JSON:API: { "data": { "type": "...", "id": "..." } }
        if (isset($relation_data['data'])) {
          $rel = $relation_data['data'];
          
          // Relació simple (ex: field_image)
          if (isset($rel['id']) && !isset($rel[0])) {
            $target_uuid = $rel['id'];
            $target_type = explode('--', $rel['type'])[0]; // file, media, taxonomy_term
            
            $targets = \Drupal::entityTypeManager()
              ->getStorage($target_type)
              ->loadByProperties(['uuid' => $target_uuid]);
            $target = reset($targets);
            
            if ($target) {
              $field_data = ['target_id' => $target->id()];
              // Afegir alt text si és imatge
              if (isset($rel['meta']['alt'])) {
                $field_data['alt'] = $rel['meta']['alt'];
              }
              $node->set($field_name, $field_data);
            }
          }
          // Relació múltiple (ex: field_tags)
          elseif (is_array($rel) && isset($rel[0])) {
            $targets = [];
            foreach ($rel as $item) {
              $target_uuid = $item['id'];
              $target_type = explode('--', $item['type'])[0];
              
              $found = \Drupal::entityTypeManager()
                ->getStorage($target_type)
                ->loadByProperties(['uuid' => $target_uuid]);
              $found_entity = reset($found);
              
              if ($found_entity) {
                $targets[] = ['target_id' => $found_entity->id()];
              }
            }
            if (!empty($targets)) {
              $node->set($field_name, $targets);
            }
          }
        }
      }

      $node->save();

      return new JsonResponse([
        'message' => 'Node actualitzat correctament',
        'nid' => $node->id(),
        'uuid' => $uuid,
        'title' => $node->getTitle()
      ], 200);

    } catch (\Exception $e) {
      return new JsonResponse([
        'error' => $e->getMessage(),
        'trace' => substr($e->getTraceAsString(), 0, 500)
      ], 500);
    }
  }
}
