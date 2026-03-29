<?php

namespace Drupal\simplenews\Plugin\Block;

use Drupal\Component\Uuid\UuidInterface;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\simplenews\Entity\Subscriber;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Provides a subscription block with all available newsletters and email field.
 *
 * @Block(
 *   id = "simplenews_subscription_block",
 *   admin_label = @Translation("Simplenews subscription"),
 *   category = @Translation("Simplenews")
 * )
 */
class SimplenewsSubscriptionBlock extends BlockBase implements ContainerFactoryPluginInterface {

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The form builder.
   *
   * @var \Drupal\Core\Form\FormBuilderInterface
   */
  protected $formBuilder;

  /**
   * The UUID service.
   *
   * @var Drupal\Component\Uuid\UuidInterface
   */
  protected $uuid;

  /**
   * The current user service.
   *
   * @var Drupal\Core\Session\AccountInterface
   */
  protected $currentUser;

  /**
   * Constructs an SimplenewsSubscriptionBlock object.
   *
   * @param array $configuration
   *   A configuration array containing information about the plugin instance.
   * @param string $plugin_id
   *   The plugin_id for the plugin instance.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Form\FormBuilderInterface $formBuilder
   *   The form builder object.
   * @param \Drupal\Component\Uuid\UuidInterface $uuid
   *   The uuid service.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user service.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition, EntityTypeManagerInterface $entity_type_manager, FormBuilderInterface $formBuilder, UuidInterface $uuid, AccountInterface $current_user) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->entityTypeManager = $entity_type_manager;
    $this->formBuilder = $formBuilder;
    $this->uuid = $uuid;
    $this->currentUser = $current_user;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('form_builder'),
      $container->get('uuid'),
      $container->get('current_user')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    // By default, the block will contain 1 newsletter.
    return [
      'show_manage' => TRUE,
      'newsletters' => [],
      'default_newsletters' => [],
      'message' => $this->t('Stay informed - subscribe to our newsletter.'),
      'unique_id' => '',
    ];
  }

  /**
   * {@inheritdoc}
   */
  protected function blockAccess(AccountInterface $account) {
    // Only allow users with the 'subscribe to newsletters' permission.
    return AccessResult::allowedIfHasPermission($account, 'subscribe to newsletters');
  }

  /**
   * {@inheritdoc}
   */
  public function blockForm($form, FormStateInterface $form_state) {
    foreach (simplenews_newsletter_get_visible() as $newsletter) {
      $options[$newsletter->id()] = $newsletter->name;
    }

    $form['show_manage'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Show manage link'),
      '#description' => $this->t('Show a link to manage existing newsletters.'),
      '#default_value' => $this->configuration['show_manage'],
    ];
    $form['newsletters'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Visible Newsletters'),
      '#description' => $this->t('Newsletters to show.'),
      '#options' => $options,
      '#default_value' => $this->configuration['newsletters'],
    ];
    $form['default_newsletters'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Default newsletters'),
      '#description' => $this->t('Newsletters that are selected by default. Newsletters that are not visible will be automatically subscribed.'),
      '#options' => $options,
      '#default_value' => $this->configuration['default_newsletters'],
    ];
    $form['message'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Block message'),
      '#size' => 60,
      '#maxlength' => 255,
      '#default_value' => $this->configuration['message'],
    ];
    $form['unique_id'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Unique ID'),
      '#size' => 60,
      '#maxlength' => 255,
      '#description' => $this->t('Each subscription block must have a unique form ID. If no value is provided, a random ID will be generated. Use this to have a predictable, short ID, e.g. to configure this form use a CAPTCHA.'),
      '#default_value' => $this->configuration['unique_id'],
    ];
    // @codingStandardsIgnoreStart
    /*if (\Drupal::moduleHandler()->moduleExists('views')) {
        $form['link_previous'] = array(
          '#type' => 'checkbox',
          '#title' => $this->t('Display link to previous issues'),
          '#return_value' => 1,
          '#default_value' => variable_get('simplenews_block_l_' . $delta, 1),
          '#description' => $this->t('Link points to newsletter/newsletter_id, which is provided by the newsletter issue list default view.'),
        );
      }*/
    /*if (\Drupal::moduleHandler()->moduleExists('views')) {
      $form['rss_feed'] = array(
        '#type' => 'checkbox',
        '#title' => $this->t('Display RSS-feed icon'),
        '#return_value' => 1,
        '#default_value' => variable_get('simplenews_block_r_' . $delta, 1),
        '#description' => $this->t('Link points to newsletter/feed/newsletter_id, which is provided by the newsletter issue list default view.'),
      );
    }*/
    // @codingStandardsIgnoreEnd
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function blockValidate($form, FormStateInterface $form_state) {
    $visible = array_filter($form_state->getValue('newsletters'));
    $default = array_filter($form_state->getValue('default_newsletters'));
    if (!$visible && !$default) {
      $form_state->setErrorByName('newsletters', $this->t('You must set at least one visible or default newsletter.'));
      $form_state->setErrorByName('default_newsletters');
    }
  }

  /**
   * {@inheritdoc}
   */
  public function blockSubmit($form, FormStateInterface $form_state) {
    $this->configuration['show_manage'] = $form_state->getValue('show_manage');
    $this->configuration['newsletters'] = array_filter($form_state->getValue('newsletters'));
    $this->configuration['default_newsletters'] = array_filter($form_state->getValue('default_newsletters'));
    $this->configuration['message'] = $form_state->getValue('message');
    // @codingStandardsIgnoreStart
    //$this->configuration['link_previous'] = $form_state->getValue('link_previous');
    //$this->configuration['rss_feed'] = $form_state->getValue('rss_feed');
    // @codingStandardsIgnoreEnd
    $this->configuration['unique_id'] = empty($form_state->getValue('unique_id')) ? $this->uuid->generate() : $form_state->getValue('unique_id');
  }

  /**
   * {@inheritdoc}
   */
  public function build() {
    /** @var \Drupal\simplenews\Form\SubscriptionsBlockForm $form_object */
    $form_object = $this->entityTypeManager->getFormObject('simplenews_subscriber', 'block')
      ->setUniqueId($this->configuration['unique_id'])
      ->setEntity(Subscriber::loadByUid($this->currentUser->id(), 'create'))
      ->setNewsletterIds($this->configuration['newsletters'], $this->configuration['default_newsletters'])
      ->setMessage($this->configuration['message'])
      ->setShowManage($this->configuration['show_manage']);

    return $this->formBuilder->getForm($form_object);
  }

}
