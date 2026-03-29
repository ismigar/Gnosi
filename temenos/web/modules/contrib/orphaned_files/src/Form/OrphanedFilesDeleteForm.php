<?php

namespace Drupal\orphaned_files\Form;

use Drupal\Core\Database\Database;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Class Initialisation.
 */
class OrphanedFilesDeleteForm extends FormBase {

  protected $fid;

  public function __construct($fid) {
    $this->fid = $fid;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    $fid = $container->get('request_stack')->getCurrentRequest()->attributes->get('fid');
    return new static($fid);
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'orphaned_files_delete_form_' . $this->fid;
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form['confirm'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('I confirm that I want to delete this file.'),
      '#required' => TRUE,
    ];

    $form['delete'] = [
      '#type' => 'submit',
      '#value' => $this->t('Delete'),
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    if ($form_state->getValue('confirm')) {
      $database = Database::getConnection();
      $database->delete('file_managed')
        ->condition('fid', $this->fid)
        ->execute();

      $this->messenger()->addMessage($this->t('The file has been deleted.'));
      $form_state->setRedirect('orphaned_files.page');
    }
    else {
      $this->messenger()->addMessage($this->t('Please confirm deletion by checking the box.'), 'error');
    }
  }

}
