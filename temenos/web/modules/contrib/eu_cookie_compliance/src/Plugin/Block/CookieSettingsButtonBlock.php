<?php

namespace Drupal\eu_cookie_compliance\Plugin\Block;

use Drupal\Core\Url;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Access\AccessResult;

/**
 * Provides a "CookieSettingsButtonBlock" block.
 *
 * @Block(
 *   id = "eu_cookie_compliance_button_block",
 *   admin_label = @Translation("EU Cookie Compliance Button Block")
 * )
 */
class CookieSettingsButtonBlock extends BlockBase implements ContainerFactoryPluginInterface {

  /**
   * Config factory.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected $configFactory;

  /**
   * Constructs the SchemaListenerController object.
   *
   * @param array $configuration
   *   Configuration.
   * @param string $plugin_id
   *   Plugin id.
   * @param mixed $plugin_definition
   *   Plugin definition.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition, ConfigFactoryInterface $config_factory) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->configFactory = $config_factory;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('config.factory')
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function blockAccess(AccountInterface $account) {
    return AccessResult::allowedIfHasPermission($account, 'display eu cookie compliance popup');
  }

  /**
   * {@inheritdoc}
   */
  public function build() {
    $config = $this->configFactory->get('eu_cookie_compliance.settings');
    if ($config->get('withdraw_enabled')) {
      return [
        '#type' => 'button',
        '#value' => $this->t('Cookie settings'),
        '#url' => Url::fromUserInput('#sliding-popup'),
        '#attributes' => [
          'class' => [
            'eu-cookie-compliance-toggle-withdraw-banner',
          ],
          'onclick' => 'if (Drupal.eu_cookie_compliance) { Drupal.eu_cookie_compliance.toggleWithdrawBanner(); } return false;',
        ],
      ];
    }
    else {
      return [
        '#title' => $this->t('Cookie settings'),
        '#markup' => $this->t('This block requires the "@withdraw_enabled_setting_name" to be enabled in <a href="@eu_cookie_compliance_settings_url">EU Cookie Compliance settings</a>.',
          [
            '@withdraw_enabled_setting_name' => $this->t('Enable floating privacy settings tab and withdraw consent banner'),
            '@eu_cookie_compliance_settings_url' => Url::fromRoute('eu_cookie_compliance.settings')->toString(),
          ]
        ),
      ];
    }
  }

}
