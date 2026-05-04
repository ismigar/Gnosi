<?php

namespace Drupal\klaro_migrator\Form;

use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Extension\ModuleHandlerInterface as ModuleHandlerInterfaceAlias;
use Drupal\Core\Extension\ModuleInstallerInterface;
use Drupal\Core\Extension\ModuleInstallerInterface as ModuleInstallerInterfaceAlias;
use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\klaro_migrator\KlaroMigrationManager as KlaroMigrationManagerAlias;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\klaro_migrator\KlaroMigrationManager;

/**
 * Form for EU Cookie Compliance to Klaro migration.
 */
class KlaroMigrationForm extends ConfirmFormBase {

  /**
   * The Klaro migration manager.
   *
   * @var KlaroMigrationManagerAlias
   */
  protected $klaroMigrationManager;

  /**
   * @var ModuleHandlerInterfaceAlias
   */
  private $moduleHandler;

  /**
   * @var ModuleInstallerInterfaceAlias
   */
  private $moduleInstaller;

  /**
   * Constructs a new KlaroMigrationForm.
   *
   * @param KlaroMigrationManagerAlias $klaro_migration_manager
   *   The Klaro migration manager.
   * @param ModuleHandlerInterfaceAlias $module_handler
   *   The module handler.
   */
  public function __construct(
    KlaroMigrationManager $klaro_migration_manager,
    ModuleHandlerInterface $module_handler,
    ModuleInstallerInterface $module_installer
  ) {
    $this->klaroMigrationManager = $klaro_migration_manager;
    $this->moduleHandler = $module_handler;
    $this->moduleInstaller = $module_installer;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('klaro_migrator.klaro_migration_manager'),
      $container->get('module_handler'),
      $container->get('module_installer')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'klaro_migration_form';
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Are you sure you want to migrate settings from EU Cookie Compliance to Klaro?');
  }

  public function installKlaro(array &$form, FormStateInterface $form_state) {
    $installed = $this->moduleHandler->moduleExists('klaro');
    if (!$installed) {
      $this->moduleInstaller->install(['klaro']);
      $this->moduleHandler = \Drupal::service('module_handler');

      $this->messenger()->addMessage($this->t('Klaro module has been installed.'));
    }
    else {
      $this->messenger()->addStatus($this->t('Klaro is already installed.'));
    }

    $form_state->setRedirect('klaro_migrator.klaro_migration_form');
  }

  public function buildForm(array $form, FormStateInterface $form_state) {
    try {
      $installed = $this->moduleHandler->moduleExists('klaro');
      /* Check if it was the install button that triggered the buildForm() */
      $input = $form_state->getUserInput();
      $trigger = isset($input['install_klaro']);
      if (!$installed) {
        // Only show the error *if the install button wasn't clicked*.
        if (!$trigger) {
          $this->messenger()->addError('To continue, install the Klaro module: https://www.drupal.org/project/klaro');
        }

        // Always show the install button when not installed.
        $form['install_klaro'] = [
          '#type' => 'submit',
          '#name' => 'install_klaro',
          '#value' => $this->t('Install Klaro module'),
          '#limit_validation_errors' => [],
          '#validate' => [],
          '#submit' => ['::installKlaro'],
        ];

        return $form;
      }

      // Klaro is installed, continue as normal.
      $this->klaroMigrationManager->checkMigratePermissions();
      return parent::buildForm($form, $form_state);
    }
    catch (\Exception $e) {
      $this->messenger()->addError($e->getMessage());
      return [];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    // Redirect to the EUCC settings form in case of cancellation.
    return new Url('eu_cookie_compliance.settings');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText() {
    return $this->t('Migrate settings now');
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    // Call the migration manager to perform the migration.
    $result = $this->klaroMigrationManager->migrate();

    // Notify the user of the migration result.
    if ($result) {
      $this->messenger()->addMessage($this->t('Migration from EU Cookie Compliance settings to Klaro completed.'));
    } else {
      $this->messenger()->addError($this->t('There was an error while migrating EU Cookie Compliance settings to Klaro.'));
    }

    // Redirect back to the EUCC settings page.
    $form_state->setRedirect('eu_cookie_compliance.settings');
  }
}
