<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\FormStateInterface;

/**
 * Form controller for the subscriber edit forms.
 *
 * The acting user is someone with administrative privileges managing any
 * subscriber.
 */
class SubscriberForm extends SubscriptionsFormBase {

  /**
   * {@inheritdoc}
   */
  protected $allowDelete = TRUE;

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state) {
    $form = parent::form($form, $form_state);
    /** @var \Drupal\simplenews\SubscriberInterface $subscriber */
    $subscriber = $this->entity;

    if ($mail = $subscriber->getMail()) {
      $form['#title'] = $this->t('Edit subscriber @mail', ['@mail' => $mail]);
    }

    if ($user = $subscriber->getUser()) {
      $form['user'] = [
        '#markup' => $this->t('This Subscription is linked to user @user. Edit the user to change the subscriber language, email and status.', ['@user' => $user->toLink(NULL, 'edit-form')->toString()]),
        '#weight' => -1,
      ];
    }

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function getSubmitMessage(FormStateInterface $form_state, $confirm) {
    if ($this->getFormId() == 'simplenews_subscriber_add_form') {
      return $this->t('Subscriber %label has been added.', ['%label' => $this->entity->label()]);
    }
    return $this->t('Subscriber %label has been updated.', ['%label' => $this->entity->label()]);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    parent::submitForm($form, $form_state);
    $form_state->setRedirect('entity.simplenews_subscriber.collection');
  }

}
