<?php

namespace Drupal\orphaned_files\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;

/**
 * {@inheritdoc}
 */
class OrphanedFilesFilter extends FormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'orphaned_files_filter_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $type_select = [
      '' => $this->t('--'),
      'document' => $this->t('Document'),
      'image' => $this->t('Image'),
      'video' => $this->t('Video'),
      'audio' => $this->t('Audio'),
    ];

    $status_select = [
      '1' => $this->t('Published'),
    ];

    $form['#method'] = 'get';

    $form['type'] = [
      '#title' => $this->t('Type'),
      '#type' => 'select',
      '#options' => $type_select,
      '#default_value' => $this->getRequest()->query->get('type', 'all'),
    ];

    $form['status'] = [
      '#title' => $this->t('Status'),
      '#type' => 'select',
      '#options' => $status_select,
      '#default_value' => $this->getRequest()->query->get('status', 'all'),
    ];

    $form['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Filter'),
    ];

    $form['reset'] = [
      '#type' => 'markup',
      '#markup' => '<a href="' . Url::fromRoute('orphaned_files.page')->toString() . '" class="button">' . $this->t('Reset') . '</a>',
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    // The form submission is handled by the GET request,
    // so no action is needed here.
  }

}
