<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Entity\ContentEntityConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;

/**
 * Builds the form to delete a contact category.
 */
class SubscriberDeleteForm extends ContentEntityConfirmFormBase {

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Are you sure you want to delete %name?', ['%name' => $this->entity->label()]);
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    return new Url('entity.simplenews_subscriber.collection');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText() {
    return $this->t('Delete');
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->entity->delete();
    $this->messenger()->addMessage($this->t('Subscriber %label has been deleted.', ['%label' => $this->entity->label()]));
    \Drupal::logger('simplenews')->notice('Subscriber %label has been deleted.', ['%label' => $this->entity->label()]);
    $form_state->setRedirect('entity.simplenews_subscriber.collection');
  }

}
