<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\SubscriberInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Do a mass subscription for a list of email addresses.
 */
class SubscriberExportForm extends FormBase {

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * Constructs a \Drupal\simplenews\Form\SubscriberExportForm object.
   *
   * @param \Drupal\Core\Entity\Query\EntityTypeManagerInterface $entity_manager
   *   The entity manager.
   */
  public function __construct(EntityTypeManagerInterface $entity_manager) {
    $this->entityTypeManager = $entity_manager;
  }

  /**
   * {@inheritDoc}
   */
  public static function create(ContainerInterface $container) {
    return new static($container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'simplenews_subscriber_export';
  }

  /**
   * Gets matching emails to export.
   *
   * @param string[] $states
   *   Filter for states.
   * @param string[] $newsletters
   *   Filter for newsletters.
   *
   * @return string
   *   Return comma separated list of emails or empty text message.
   */
  protected function getEmails(array $states, array $newsletters) {
    // Build conditions for active state, subscribed state and newsletter
    // selection.
    if (isset($states['active'])) {
      $condition_active[] = SubscriberInterface::ACTIVE;
    }
    if (isset($states['inactive'])) {
      $condition_active[] = SubscriberInterface::INACTIVE;
    }
    if (isset($states['unconfirmed'])) {
      $condition_active[] = SubscriberInterface::UNCONFIRMED;
    }

    // Get emails from the database.
    $query = $this->entityTypeManager->getStorage('simplenews_subscriber')->getQuery()
      ->condition('status', $condition_active, 'IN')
      ->condition('subscriptions.target_id', $newsletters, 'IN');
    $subscriber_ids = $query->accessCheck(FALSE)->execute();

    $mails = [];
    foreach ($subscriber_ids as $id) {
      $subscriber = Subscriber::load($id);
      $mails[] = $subscriber->getMail();
    }

    if ($mails) {
      return implode(", ", $mails);
    }
    return $this->t('No addresses were found.');
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    // Get sensible default values for the form elements in this form.
    $query = $this->getRequest()->query;
    $default['states'] = $query->all()['states'] ?? ['active' => 'active'];
    $default['newsletters'] = $query->all()['newsletters'] ?? [];

    $form['states'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Status'),
      '#options' => [
        'active' => $this->t('Active users'),
        'inactive' => $this->t('Inactive users'),
        'unconfirmed' => $this->t('Unconfirmed users'),
      ],
      '#default_value' => $default['states'],
      '#description' => $this->t('Subscriptions matching the selected states will be exported.'),
      '#required' => TRUE,
    ];

    $options = simplenews_newsletter_list();
    $form['newsletters'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Newsletter'),
      '#options' => $options,
      '#default_value' => $default['newsletters'],
      '#description' => $this->t('Subscriptions matching the selected newsletters will be exported.'),
      '#required' => TRUE,
    ];

    // Get export results and display them in a text area. Only get the results
    // if the form is build after redirect, not after submit.
    $input = $form_state->getUserInput();
    if ($query->has('states') && empty($input)) {
      $form['emails'] = [
        '#type' => 'textarea',
        '#title' => $this->t('Export results'),
        '#cols' => 60,
        '#rows' => 5,
        '#value' => $this->getEmails($default['states'], $default['newsletters']),
      ];
    }

    $form['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Export'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $form_values = $form_state->getValues();

    // Get data for query string and redirect back to the current page.
    $options['query']['states'] = array_filter($form_values['states']);
    $options['query']['newsletters'] = array_keys(array_filter($form_values['newsletters']));
    $form_state->setRedirect('simplenews.subscriber_export', [], $options);
  }

}
