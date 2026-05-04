<?php

namespace Drupal\eu_cookie_compliance\EventSubscriber;

use Drupal\Core\Config\ConfigCrudEvent;
use Drupal\Core\Config\ConfigEvents;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\eu_cookie_compliance\Service\ScriptFileManager;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Updates a javascript on config save.
 *
 * @package Drupal\eu_cookie_compliance\EventSubscriber
 */
class EuCookieComplianceConfigEventsSubscriber implements EventSubscriberInterface {

  /**
   * The file system service.
   *
   * @var \Drupal\Core\File\FileSystemInterface
   */
  protected $fileSystem;

  /**
   * The messenger.
   *
   * @var \Drupal\Core\Messenger\MessengerInterface
   */
  protected $messenger;

  /**
   * @var \Drupal\eu_cookie_compliance\Service\ScriptFileManager
   */
  protected ScriptFileManager $script_file_manager;

  use StringTranslationTrait;

  /**
   * Constructs a new FileUploadForm.
   *
   * @param \Drupal\Core\File\FileSystemInterface $file_system
   *   The file repository service.
   * @param \Drupal\Core\Messenger\MessengerInterface $messenger
   *   The messenger service.
   * @param \Drupal\eu_cookie_compliance\Service\ScriptFileManager $script_file_manager
   */
  public function __construct(
    FileSystemInterface $file_system,
    MessengerInterface $messenger,
    ScriptFileManager $script_file_manager
  ) {
    $this->fileSystem = $file_system;
    $this->messenger = $messenger;
    $this->script_file_manager = $script_file_manager;
  }

  /**
   * {@inheritdoc}
   *
   * @return array
   *   The event names to listen for, and the methods that should be executed.
   */
  public static function getSubscribedEvents() : array {
    return [
      ConfigEvents::SAVE => 'configSave',
    ];
  }

  /**
   * React to a config object being saved.
   *
   * @param \Drupal\Core\Config\ConfigCrudEvent $event
   *   Config crud event.
   */
  public function configSave(ConfigCrudEvent $event) {

    if (($event->getConfig()->getName() === 'eu_cookie_compliance.settings')) {
      $disabled_javascripts = $event->getConfig()->get('disabled_javascripts');

      /* Do we have javascript to disable?? */
      if (!empty($disabled_javascripts)) {
        $this->script_file_manager
          ->buildDisabledJsScript($disabled_javascripts)
          ->save();
      } else {
        /* No need for this file since disabled javascript is empty => remove it */
        $this->script_file_manager->delete();
      }
    }
  }
}
