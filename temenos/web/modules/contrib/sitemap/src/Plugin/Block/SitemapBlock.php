<?php

namespace Drupal\sitemap\Plugin\Block;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\DependencyInjection\ClassResolverInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Provides the Sitemap in a block.
 */
#[Block(
  id: "sitemap",
  admin_label: new TranslatableMarkup("Sitemap")
)]
class SitemapBlock extends BlockBase implements ContainerFactoryPluginInterface {

  /**
   * Class Resolver service.
   *
   * @var \Drupal\Core\DependencyInjection\ClassResolverInterface
   */
  protected ClassResolverInterface $classResolver;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = new static($configuration, $plugin_id, $plugin_definition);
    $instance->classResolver = $container->get('class_resolver');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function blockAccess(AccountInterface $account) {
    return AccessResult::allowedIfHasPermission($account, 'access sitemap');
  }

  /**
   * {@inheritdoc}
   */
  public function build() {
    return $this->classResolver->getInstanceFromDefinition('\Drupal\sitemap\Controller\SitemapController')->buildSitemap();
  }

}
