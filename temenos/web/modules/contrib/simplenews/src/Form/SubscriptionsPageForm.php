<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\simplenews\Entity\Subscriber;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Configure subscriptions of the currently authenticated subscriber.
 */
class SubscriptionsPageForm extends SubscriptionsFormBase {

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, $snid = NULL, $timestamp = NULL, $hash = NULL) {
    // Try to load the corresponding subscriber.
    $subscriber = Subscriber::load($snid);
    if ($subscriber && $hash == simplenews_generate_hash($subscriber->getMail(), 'manage', $timestamp)) {
      $this->setEntity($subscriber);
    }
    else {
      throw new NotFoundHttpException();
    }

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state) {
    $form = parent::form($form, $form_state);
    $form['subscriptions']['widget']['#title'] = $this->t('Subscriptions for %mail', ['%mail' => $this->entity->getMail()]);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state) {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#value'] = $this->t('Update');
    return $actions;
  }

  /**
   * {@inheritdoc}
   */
  protected function getSubmitMessage(FormStateInterface $form_state, $confirm) {
    return $this->t('Your newsletter subscriptions have been updated.');
  }

}
