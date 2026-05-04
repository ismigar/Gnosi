<?php

namespace Drupal\simplenews\RecipientHandler;

use Drupal\Component\Utility\Xss;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\simplenews\Entity\Newsletter;

/**
 * Provides an recipient handler plugin manager.
 *
 * @see \Drupal\simplenews\RecipientHandler\Annotations\RecipientHandler
 * @see \Drupal\simplenews\RecipientHandler\RecipientHandlerInterface
 * @see plugin_api
 */
class RecipientHandlerManager extends DefaultPluginManager {

  /**
   * Constructs a RecipientHandlerManager object.
   *
   * @param \Traversable $namespaces
   *   An object that implements \Traversable which contains the root paths
   *   keyed by the corresponding namespace to look for plugin implementations.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache_backend
   *   Cache backend instance to use.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler to invoke the alter hook with.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct('Plugin/simplenews/RecipientHandler', $namespaces, $module_handler, 'Drupal\simplenews\RecipientHandler\RecipientHandlerInterface', 'Drupal\simplenews\RecipientHandler\Annotation\RecipientHandler');
    $this->alterInfo('simplenews_recipient_handler_info');
    $this->setCacheBackend($cache_backend, 'simplenews_recipient_handler_info_plugins');
  }

  /**
   * Returns the options for a recipient handler form field.
   *
   * @param string $newsletter_id
   *   (optional) Restrict to handlers that are valid for the specified
   *   newsletter ID.
   *
   * @return array
   *   An array with key as handler ID and value as handler label.
   */
  public function getOptions($newsletter_id = NULL) {
    $handlers = $this->getDefinitions();

    $options = [];
    foreach ($handlers as $handler => $settings) {
      $options[$handler] = Xss::filter($settings['title']);
    }

    if ($newsletter_id && ($newsletter = Newsletter::load($newsletter_id))) {
      $allowed_handlers = array_filter($newsletter->allowed_handlers);
      if ($allowed_handlers) {
        $options = array_intersect_key($options, $allowed_handlers);
      }
    }

    return $options;
  }

}
