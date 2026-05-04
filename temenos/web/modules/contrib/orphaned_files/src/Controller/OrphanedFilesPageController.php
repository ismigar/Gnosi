<?php

namespace Drupal\orphaned_files\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Database\Database;
use Drupal\Core\Form\FormBuilderInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * {@inheritdoc}
 */
class OrphanedFilesPageController extends ControllerBase {

  /**
   * The form builder.
   *
   * @var \Drupal\Core\Form\FormBuilderInterface
   */
  protected $formBuilder;

  /**
   * Constructs a new object.
   *
   * @param \Drupal\Core\Form\FormBuilderInterface $form_builder
   *   The form builder.
   */
  public function __construct(FormBuilderInterface $form_builder) {
    $this->formBuilder = $form_builder;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('form_builder')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function page(Request $request) {
    $filters_form = $this->formBuilder->getForm('\Drupal\orphaned_files\Form\OrphanedFilesFilter');
    $files_list = $this->getFilesList($request);

    return [
      '#theme' => 'orphaned_files_page',
      '#filters_form' => $filters_form,
      '#files_list' => $files_list,
    ];
  }

  /**
   * {@inheritdoc}
   */
  protected function getFilesList(Request $request) {
    $connection = Database::getConnection();

    $query = $connection->select('file_managed', 'fm');
    $query->fields('fm', ['fid', 'filename', 'filemime', 'uid', 'status', 'created', 'filesize']);
    $query->leftJoin('file_usage', 'fu', 'fm.fid = fu.fid');
    $query->addField('fu', 'count', 'usage_count');
    $query->condition('fu.count', [0, 1], 'BETWEEN');

    if ($type = $request->query->get('type')) {
      if ($type !== 'all') {
        $query->condition('fm.filemime', '%' . $type . '%', 'LIKE');
      }
    }

    if (($status = $request->query->get('status')) !== 'all') {
      $query->condition('fm.status', $status);
    }

    return $query->execute()->fetchAll();
  }

  /**
   * {@inheritdoc}
   */
  public function deleteFile($fid) {
    $connection = Database::getConnection();
    $connection->delete('file_managed')
      ->condition('fid', $fid)
      ->execute();

    $this->messenger()->addMessage($this->t('The file has been deleted.'));
    return $this->redirect('orphaned_files.page');
  }

}
