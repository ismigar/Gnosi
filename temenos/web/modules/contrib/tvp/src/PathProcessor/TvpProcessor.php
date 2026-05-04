<?php

namespace Drupal\tvp\PathProcessor;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\PathProcessor\InboundPathProcessorInterface;
use Drupal\Core\PathProcessor\OutboundPathProcessorInterface;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\path_alias\AliasManagerInterface;
use Drupal\path_alias\AliasRepositoryInterface;
use Drupal\views\Views;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Processes the inbound and outbound pager query.
 */
class TvpProcessor implements InboundPathProcessorInterface, OutboundPathProcessorInterface {

  /**
   * The path alias manager.
   *
   * @var \Drupal\path_alias\AliasManagerInterface
   */
  protected $aliasManager;

  /**
   * The language manager.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;


  /**
   * The alias repository.
   *
   * @var \Drupal\path_alias\AliasRepositoryInterface
   */
  protected $aliasStorage;

  /**
   * Cache backend instance to use.
   *
   * @var \Drupal\Core\Cache\CacheBackendInterface
   */
  protected $cacheBackend;

  /**
   * The view path aliases.
   *
   * @var array
   */
  protected $viewPathAliases;


  /**
   * The request stack object.
   *
   * @var \Symfony\Component\HttpFoundation\RequestStack
   */
  protected $requestStack;

  /**
   * TvpProcessor constructor.
   *
   * @param \Drupal\path_alias\AliasManagerInterface $alias_manager
   *   The path alias manager.
   * @param \Drupal\Core\Language\LanguageManagerInterface $language_manager
   *   The language manager.
   * @param \Drupal\path_alias\AliasRepositoryInterface $alias_storage
   *   The alias repository.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache_backend
   *   Cache backend instance to use.
   * @param \Symfony\Component\HttpFoundation\RequestStack $request_stack
   *   The request stack service.
   */
  public function __construct(
    AliasManagerInterface $alias_manager,
    LanguageManagerInterface $language_manager,
    AliasRepositoryInterface $alias_storage,
    CacheBackendInterface $cache_backend,
    RequestStack $request_stack,
  ) {
    $this->aliasManager = $alias_manager;
    $this->languageManager = $language_manager;
    $this->aliasStorage = $alias_storage;
    $this->cacheBackend = $cache_backend;
    $this->requestStack = $request_stack;

  }

  /**
   * {@inheritdoc}
   */
  public function processInbound($path, Request $request) {
    return $this->getInboundPath($path);
  }

  /**
   * {@inheritdoc}
   */
  public function processOutbound($path, &$options = [], Request|null $request = NULL, BubbleableMetadata|null $bubbleable_metadata = NULL) {
    // Normalitza per evitar passar NULL a cap altra rutina.
    if ($path === NULL) {
      $path = '';
    }
    return $this->getOutboundPath($path, $options);
  }

  /**
   * Replace inbound path when needed.
   *
   * @param string $path
   *   The path to process.
   *
   * @return string|string[]
   *   The processed path.
   */
  public function getInboundPath(string $path) {
    $request_path_info = $this->requestStack->getCurrentRequest()->getPathInfo();
    if ($request_path_info === $path) {
      if (strpos($path, "/admin") === FALSE) {
        $lang_code = $this->languageManager->getCurrentLanguage()->getId();
        $default_lang_code = $this->languageManager->getDefaultLanguage()
          ->getId();
        $view_path_aliases = $this->getViewPathAliases();
        if ($lang_code != $default_lang_code
          && !($this->aliasStorage->lookupByAlias($this->strReplaceFirst('/' . $lang_code, '', $path), $lang_code))
          && strpos($path, "/" . $lang_code) !== FALSE && $view_path_aliases != NULL) {
          foreach ($view_path_aliases as $view_path) {
            if (isset($view_path["path"])) {
              $trans_path_complete = "/" . $view_path["language"] . $view_path["trans_path"];
              if (strpos($path, $trans_path_complete) !== FALSE) {
                $path = $this->strReplaceFirst($trans_path_complete, '/' . $lang_code . $view_path["path"], $path);
                break;
              }
            }

          }
        }
      }
    }
    return $path;
  }

  /**
   * Replace outbound path when needed.
   *
   * @param string $path
   *   The path to process.
   * @param array $options
   *   An associative array of additional options.
   *
   * @return string|string[]
   *   The processed path.
   */
  public function getOutboundPath(string $path, array &$options = []) {
    if ($path === NULL || $path === '') {
      return '';
    }

    $view_path_aliases = $this->getViewPathAliases();

    if (strpos($path, "/admin") === FALSE && $path != "/" && $view_path_aliases != NULL) {
      foreach ($view_path_aliases as $view_path) {
        if (isset($view_path["path"])) {
          $lang_code = isset($options['language']) ? $options['language']->getId() : NULL;
          if (strpos($path, $view_path["path"]) !== FALSE && isset($lang_code)
            && $view_path["language"] == $lang_code) {
            $path = $this->strReplaceFirst($view_path["path"], $view_path["trans_path"], $path, $view_path['language']);
            break;
          }
        }
      }
    }
    return $path;
  }

  /**
   * Replace first string found.
   *
   * @param string $search
   *   The search keyword.
   * @param string $replace
   *   The replace keyword.
   * @param string $subject
   *   The subject.
   * @param string|null $lang_code
   *   The language code.
   *
   * @return string|string[]
   *   The replaced string.
   */
  private function strReplaceFirst(string $search, string $replace, string $subject, string|null $lang_code = NULL) {
    if ($lang_code !== NULL && ($this->aliasManager->getPathByAlias($subject, $lang_code) != $search || $this->aliasManager->getAliasByPath($subject, $lang_code) === $subject)) {
      return $subject;
    }
    $pos = strpos($subject, $search);
    if ($pos !== FALSE) {
      return substr_replace($subject, $replace, $pos, strlen($search));
    }
    return $subject;
  }

  /**
   * Return the aliases which are for view paths.
   *
   * @return array
   *   An array containing the aliases.
   */
  private function getViewPathAliases() {
    if (!isset($this->viewPathAliases)) {
      // Check cache.
      if ($cache = $this->cacheBackend->get('view_path_aliases_cid')) {
        $view_path_aliases = $cache->data;
      }
      else {
        $view_paths = $this->getViewPathOptions();
        $langcodes = $this->languageManager->getLanguages();
        $view_path_aliases = [];
        foreach ($view_paths as $view_path) {
          foreach ($langcodes as $langcode) {
            $url_alias = $this->aliasManager->getAliasByPath("/" . $view_path, $langcode->getId());
            $view_path_aliases[] = [
              'path' => "/" . $view_path,
              'language' => $langcode->getId(),
              'trans_path' => $url_alias,
            ];
          }
        }
        $twenty_four_hours = 60 * 60 * 24;

        // Set the cache.
        $this->cacheBackend->set("view_path_aliases_cid", $view_path_aliases, time() + $twenty_four_hours);
      }

      $this->viewPathAliases = $view_path_aliases;
    }

    return $this->viewPathAliases;
  }

  /**
   * Fetch paths of all views.
   *
   * @return array
   *   An array containing the paths for views.
   */
  private function getViewPathOptions() {
    $views_list = Views::getAllViews();
    $view_paths = [];
    foreach ($views_list as $view) {
      $displays = $view->get("display");
      foreach ($displays as $display) {
        $display_id = $display['id'] ?? NULL;
        if ($display_id != NULL && $view->getDisplay($display_id) != NULL && isset($view->getDisplay($display_id)['display_options'])
          && isset($view->getDisplay($display_id)['display_options']['path'])) {
          $path = $view->getDisplay($display_id)['display_options']['path'];
          if ($path != NULL && !empty($path && strpos($path, "admin/") === FALSE)) {
            $view_paths[$path] = $path;
          }
        }
      }
    }
    return $view_paths;
  }

}
