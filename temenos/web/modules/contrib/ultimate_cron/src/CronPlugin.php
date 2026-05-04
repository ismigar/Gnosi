<?php

namespace Drupal\ultimate_cron;
use Drupal\Component\Plugin\ConfigurableInterface;
use Drupal\Component\Plugin\DependentPluginInterface;
use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\PluginBase;
use Drupal\Core\Plugin\PluginFormInterface;

/**
 * This is the base class for all Ultimate Cron plugins.
 *
 * This class handles all the load/save settings for a plugin as well as the
 * forms, etc.
 */
class CronPlugin extends PluginBase implements PluginInspectionInterface, ConfigurableInterface, DependentPluginInterface, PluginFormInterface {
  static public $multiple = FALSE;
  static public $instances = array();
  public $weight = 0;
  static public $globalOptions = array();

  /**
   * {@inheritdoc}
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->setConfiguration($configuration);
  }

  /**
   * Returns a list of plugin types.
   *
   * @return array
   */
  public static function getPluginTypes() {
    return array(
      'scheduler' => t('Scheduler'),
      'launcher' => t('Launcher'),
      'logger' => t('Logger')
    );
  }


  /**
   * {@inheritdoc}
   */
  public function getConfiguration() {
    return $this->configuration;
  }

  /**
   * {@inheritdoc}
   */
  public function setConfiguration(array $configuration) {
    $this->configuration = array_merge(
      $this->defaultConfiguration(),
      $configuration
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    return array();
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies() {
    return array();
  }

  /**
   * {@inheritdoc}
   */
  public function validateConfigurationForm(array &$form, FormStateInterface $form_state) {

  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    return array();
  }

  /**
   * {@inheritdoc}
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state) {

  }

  /**
   * Get global plugin option.
   *
   * @param string $name
   *   Name of global plugin option to get.
   *
   * @return mixed
   *   Value of option if any, NULL if not found.
   */
  static public function getGlobalOption($name) {
    return isset(static::$globalOptions[$name]) ? static::$globalOptions[$name] : NULL;
  }

  /**
   * Get all global plugin options.
   *
   * @return array
   *   All options currently set, keyed by name.
   */
  static public function getGlobalOptions() {
    return static::$globalOptions;
  }

  /**
   * Set global plugin option.
   *
   * @param string $name
   *   Name of global plugin option to get.
   * @param string $value
   *   The value to give it.
   */
  static public function setGlobalOption($name, $value) {
    static::$globalOptions[$name] = $value;
  }

  /**
   * Get label for a specific setting.
   */
  public function settingsLabel($name, $value) {
    if (is_array($value)) {
      return implode(', ', $value);
    }
    else {
      return $value;
    }
  }

  /**
   * Default plugin valid for all jobs.
   */
  public function isValid($job = NULL) {
    return TRUE;
  }

}
