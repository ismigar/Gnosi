<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;

/**
 * Entity form for Subscriber with common routines.
 */
abstract class SubscriptionsFormBase extends ContentEntityForm {

  /**
   * Allow delete button.
   *
   * @var bool
   */
  protected $allowDelete = FALSE;

  /**
   * Returns a message to display to the user upon successful form submission.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state object.
   * @param bool $confirm
   *   Whether a confirmation mail is sent or not.
   *
   * @return string
   *   A HTML message.
   */
  abstract protected function getSubmitMessage(FormStateInterface $form_state, $confirm);

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state) {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#submit'][] = '::submitExtra';
    if (!$this->allowDelete) {
      unset($actions['delete']);
    }

    return $actions;
  }

  /**
   * Extra submit callback.
   *
   * @param array $form
   *   The form structure.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state object.
   */
  public function submitExtra(array $form, FormStateInterface $form_state) {
    $this->messenger()->addMessage($this->getSubmitMessage($form_state, FALSE));
  }

}
