<?php

namespace Drupal\eu_cookie_compliance\Service;

use Drupal\Core\File\FileExists;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;

class ScriptFileManager {
  use StringTranslationTrait;

  /**
   * @var string
   */
  protected string $directory;

  /**
   * The file system service.
   *
   * @var \Drupal\Core\File\FileSystemInterface
   */
  protected FileSystemInterface $fileSystem;

  /**
   * The messenger.
   *
   * @var \Drupal\Core\Messenger\MessengerInterface
   */
  protected MessengerInterface $messenger;

  /**
   * The file name of the script being saved to.
   * @var string
   *
   */
  protected string $fileName;

  /**
   * Holds the processed disabling script string
   * @var string
   *
   */
  protected string $generatedScript;

  public function __construct(FileSystemInterface $fileSystem, MessengerInterface $messenger) {
    $this->fileSystem = $fileSystem;
    $this->messenger = $messenger;
    /* Set this by default, they can over-write it later if needed */
    $this->directory = "public://eu_cookie_compliance";
    $this->fileName = "eu_cookie_compliance.script.js";
  }

  public function setDirectory($directory): void {
    if (!empty($directory)) {
      $this->directory = $directory;
    }
  }

  public function setFileName($filename): void {
    if (!empty($filename)) {
      $this->fileName = $filename;
    }
  }

  private function absolutePath(): string {
    return $this->directory . '/' . $this->fileName;
  }

  /**
   * Build a disabled javascript snippet.
   *
   * @param string $disabled_javascripts
   *   A non-empty, URL-encoded string of JavaScript file references
   *
   */
  public function buildDisabledJsScript(string $disabled_javascripts): static {
    $load_disabled_scripts = [];

    $disabled_javascripts = _eu_cookie_compliance_explode_multiple_lines($disabled_javascripts);
    $disabled_javascripts = array_filter($disabled_javascripts, 'strlen');

    foreach ($disabled_javascripts as $script) {
      $parts = explode('%3A', $script);
      $category = NULL;
      if (count($parts) > 1) {
        $category = array_shift($parts);
        $script = implode(':', $parts);
      }

      // Split the string if a | is present.
      // The second parameter (after the |) will be used to trigger a script
      // attach.
      $attach_name = '';
      if (strpos($script, '%7C') !== FALSE) {
        // Swallow a notice in case there are no behavior or library names.
        @list($script, $attach_name) = explode('%7C', $script);
      }

      _eu_cookie_compliance_convert_relative_uri($script);
      // Remove URL decoding from the strings, as url encoding makes the urls
      // not load when the javascript executes.
      $script = urldecode(urldecode($script));

      if (strpos($script, 'http') !== 0 && strpos($script, '//') !== 0) {
        $script = '/' . $script;
      }

      $load_disabled_scripts[] = [
        'src' => $script,
        'options' => [
          'categoryWrap' => !empty($category),
          'categoryName' => !empty($category) ? $category : '',
          'loadByBehavior' => !empty($attach_name),
          'attachName' => !empty($attach_name) ? $attach_name : null,
        ],
      ];
    }

    $disabled_json_list = json_encode($load_disabled_scripts,JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $this->generatedScript = <<<JS
      window.euCookieComplianceLoadScripts = function(category) {
        const unverifiedScripts = drupalSettings.eu_cookie_compliance.unverified_scripts;
        const scriptList = {$disabled_json_list};
        scriptList.forEach(({src, options}) => {
          function createSnippet(src, options) {
            const tag = document.createElement("script");
            tag.src = decodeURI(src);
            if (options.loadByBehavior && options.attachName) {
              const intervalId = setInterval(() => {
                if (Drupal.behaviors[options.attachName]) {
                  Drupal.behaviors[options.attachName].attach(document, drupalSettings);
                  clearInterval(intervalId);
                }
              }, 100);
            }
            document.body.appendChild(tag);
          }

          if (!unverifiedScripts.includes(src)) {
            if (options.categoryWrap && options.categoryName === category) {
              createSnippet(src, options);
            } else if (!options.categoryWrap) {
              createSnippet(src, options);
            }
          }
        });
      }
    JS;

    return $this;
  }

  /**
   * Saves the disabling javascript snippet to a file
   *
   */
  public function save(): bool {
    if (!is_dir($this->directory) || !is_writable($this->directory)) {
      $this->fileSystem->prepareDirectory($this->directory,
        FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS);
    }

    if (is_writable($this->directory)) {
      if ((float) \Drupal::VERSION < 10.3) {
        $this->fileSystem->saveData($this->generatedScript, $this->absolutePath(), FileSystemInterface::EXISTS_REPLACE);
      } else {
        $this->fileSystem->saveData($this->generatedScript, $this->absolutePath(), FileExists::Replace);
      }
    } else {
      $this->messenger->addError($this->t('Could not generate the EU Cookie Compliance JavaScript file that would be used for handling disabled JavaScripts. There may be a problem with your files folder.'));
      return false;
    }
    return true;
  }

  public function delete(): bool {
    if (!empty($this->absolutePath())) {
      return $this->fileSystem->delete($this->absolutePath());
    }
    return false;
  }
}