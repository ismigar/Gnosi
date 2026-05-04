<?php

namespace Drupal\remove_unused_files_form\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\remove_unused_files\RemoveUnusedFilesService;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Remove unused files form class.
 */
class RemoveUnusedFilesForm extends FormBase {

  /**
   * {@inheritdoc}
   */
  public function __construct(protected RemoveUnusedFilesService $removeUnusedFiles) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static($container->get('remove_unused_files'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'remove_unused_files_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form['actions'] = [
      '#type' => 'fieldset',
      'title' => [
        '#type' => 'html_tag',
        '#tag' => 'h6',
        '#value' => $this->t('Change the status of all unused management files to "Temporary files".'),
      ],
      'description' => [
        '#type' => 'html_tag',
        '#tag' => 'p',
        '#value' => $this->t('Any customizations will be lost. This action cannot be undone.'),
      ],
      'submit' => [
        '#type' => 'submit',
        '#value' => $this->t('Execute'),
        '#button_type' => 'danger',
        '#description' => $this->t('Any customizations will be lost. This action cannot be undone.'),
      ],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $result = $this->removeUnusedFiles->exec();
    // phpcs:ignore Drupal.Semantics.FunctionT.NotLiteralString
    $this->messenger()->addMessage($this->t($result->messageString), $result->messageType);
  }

}
