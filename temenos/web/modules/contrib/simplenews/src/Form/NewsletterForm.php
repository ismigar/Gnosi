<?php

namespace Drupal\simplenews\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Utility\LinkGeneratorInterface;
use Drupal\simplenews\RecipientHandler\RecipientHandlerManager;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Base form for category edit forms.
 */
class NewsletterForm extends EntityForm {

  /**
   * The recipient handler manager.
   *
   * @var Drupal\simplenews\RecipientHandler\RecipientHandlerManager
   */
  protected $simpleNewsRecipientHandler;

  /**
   * The link generator service.
   *
   * @var Drupal\Core\Utility\LinkGeneratorInterface
   */
  protected $linkGenerator;

  /**
   * Constructs a \Drupal\simplenews\Form\NewsletterForm object.
   *
   * @param \Drupal\simplenews\RecipientHandler\RecipientHandlerManager $simpleNewsRecipientHandler
   *   The recipient handler manager.
   * @param \Drupal\Core\Utility\LinkGeneratorInterface $link_generator
   *   The link generator.
   */
  public function __construct(RecipientHandlerManager $simpleNewsRecipientHandler, LinkGeneratorInterface $link_generator) {
    $this->simpleNewsRecipientHandler = $simpleNewsRecipientHandler;
    $this->linkGenerator = $link_generator;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('plugin.manager.simplenews_recipient_handler'),
      $container->get('link_generator')
    );
  }

  /**
   * Overrides Drupal\Core\Entity\EntityForm::form().
   */
  public function form(array $form, FormStateInterface $form_state) {
    $form = parent::form($form, $form_state);

    $newsletter = $this->entity;

    $form['name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#maxlength' => 255,
      '#default_value' => $newsletter->label(),
      '#description' => $this->t("The newsletter name."),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $newsletter->id(),
      '#maxlength' => EntityTypeInterface::BUNDLE_MAX_LENGTH,
      '#machine_name' => [
        'exists' => ['Drupal\simplenews\Entity\Newsletter', 'load'],
        'source' => ['name'],
      ],
      '#disabled' => !$newsletter->isNew(),
    ];
    $form['description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Description'),
      '#default_value' => $newsletter->description,
      '#description' => $this->t("A description of the newsletter."),
    ];
    $links = [':mime_mail_url' => 'http://drupal.org/project/mimemail', ':html_url' => 'http://drupal.org/project/htmlmail'];
    $description = $this->t('Newsletter format. Install <a href=":mime_mail_url">Mime Mail</a> module or <a href=":html_url">HTML Mail</a> module to send newsletters in HTML format.', $links);
    $form['weight'] = [
      '#type' => 'hidden',
      '#value' => $newsletter->weight,
    ];
    $form['subscription'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Subscription settings'),
      '#collapsible' => FALSE,
    ];

    // Allowed recipient handlers.
    $options = $this->simpleNewsRecipientHandler->getOptions();
    $form['subscription']['allowed_handlers'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Allowed recipient handlers'),
      '#options' => $options,
      '#default_value' => $newsletter->allowed_handlers,
      '#description' => $this->t('Restrict which recipient handlers are allowed when using this newsletter.  If none are selected, then all of them will be available.'),
      '#access' => count($options) > 1,
    ];

    // Subscribe at account registration time.
    $options = simplenews_new_account_options();
    $form['subscription']['new_account'] = [
      '#type' => 'select',
      '#title' => $this->t('Subscribe new account'),
      '#options' => $options,
      '#default_value' => $newsletter->new_account,
      '#description' => $this->t('None: This newsletter is not listed on the user registration page.<br />Default on: This newsletter is listed on the user registration page and is selected by default.<br />Default off: This newsletter is listed on the user registration page and is not selected by default.<br />Silent: A new user is automatically subscribed to this newsletter. The newsletter is not listed on the user registration page.'),
    ];

    // Type of (un)subsribe confirmation.
    $options = simplenews_access_options();
    $form['subscription']['access'] = [
      '#type' => 'select',
      '#title' => $this->t('Access'),
      '#options' => $options,
      '#default_value' => $newsletter->access,
      '#description' => $this->t("Default: Any user with 'Subscribe to newsletters' permission can subscribe and unsubscribe.<br />Hidden: Subscription is mandatory or controlled programmatically."),
    ];

    $form['subscription']['reason'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Reason'),
      '#default_value' => $newsletter->reason,
      '#description' => $this->t("Reason why the subscriber is receiving this newsletter, normally shown in the email footer. This is particularly important for hidden newsletters."),
    ];

    $form['email'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Email settings'),
      '#collapsible' => FALSE,
    ];
    // Hide format selection if there is nothing to choose.
    // The default format is plain text.
    $format_options = simplenews_format_options();
    if (count($format_options) > 1) {
      $form['email']['format'] = [
        '#type' => 'radios',
        '#title' => $this->t('Email format'),
        '#default_value' => $newsletter->format,
        '#options' => $format_options,
      ];
    }
    else {
      $form['email']['format'] = [
        '#type' => 'hidden',
        '#value' => key($format_options),
      ];
      $form['email']['format_text'] = [
        '#markup' => $this->t('Newsletter emails will be sent in %format format.', ['%format' => $newsletter->format]),
      ];
    }
    // Type of hyperlinks.
    $form['email']['hyperlinks'] = [
      '#type' => 'radios',
      '#title' => $this->t('Hyperlink conversion'),
      '#description' => $this->t('Determine how the conversion to text is performed.'),
      '#options' => [$this->t('Append hyperlinks as a numbered reference list'), $this->t('Display hyperlinks inline with the text')],
      '#default_value' => $newsletter->hyperlinks,
      '#states' => [
        'visible' => [
          ':input[name="format"]' => [
            'value' => 'plain',
          ],
        ],
      ],
    ];

    $form['email']['priority'] = [
      '#type' => 'select',
      '#title' => $this->t('Email priority'),
      '#default_value' => $newsletter->priority,
      '#options' => simplenews_get_priority(),
    ];
    $form['email']['receipt'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Request receipt'),
      '#return_value' => 1,
      '#default_value' => $newsletter->receipt,
    ];

    // Email sender name.
    $form['simplenews_sender_information'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Sender information'),
      '#collapsible' => FALSE,
    ];
    $form['simplenews_sender_information']['from_name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('From name'),
      '#size' => 60,
      '#maxlength' => 128,
      '#default_value' => $newsletter->from_name,
    ];

    // Email subject.
    $form['simplenews_subject'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Newsletter subject'),
      '#collapsible' => FALSE,
    ];

    $form['simplenews_subject']['subject'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Email subject'),
      '#size' => 60,
      '#maxlength' => 128,
      '#required' => TRUE,
      '#default_value' => $newsletter->subject,
    ];

    if ($this->moduleHandler->moduleExists('token')) {
      $form['simplenews_subject']['token_browser'] = [
        '#theme' => 'token_tree_link',
        '#token_types' => [
          'simplenews-newsletter', 'node', 'simplenews-subscriber',
        ],
      ];
    }

    // Email from address.
    $form['simplenews_sender_information']['from_address'] = [
      '#type' => 'email',
      '#title' => $this->t('From email address'),
      '#size' => 60,
      '#maxlength' => 128,
      '#required' => TRUE,
      '#default_value' => $newsletter->from_address,
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Save'),
      '#weight' => 50,
    ];

    if ($newsletter->id) {
      $form['actions']['delete'] = [
        '#type' => 'submit',
        '#value' => $this->t('Delete'),
        '#weight' => 55,
      ];
    }
    return $form;
  }

  /**
   * Overrides Drupal\Core\Entity\EntityForm::save().
   */
  public function save(array $form, FormStateInterface $form_state) {
    $newsletter = $this->entity;
    $status = $newsletter->save();

    $edit_link = $this->linkGenerator->generate($this->t('Edit'), $this->entity->toUrl());

    if ($status == SAVED_UPDATED) {
      $this->messenger()->addMessage($this->t('Newsletter %label has been updated.', ['%label' => $newsletter->label()]));
      $this->logger('simplenews')->notice('Newsletter %label has been updated.', ['%label' => $newsletter->label(), 'link' => $edit_link]);
    }
    else {
      $this->messenger()->addMessage($this->t('Newsletter %label has been added.', ['%label' => $newsletter->label()]));
      $this->logger('simplenews')->notice('Newsletter %label has been added.', ['%label' => $newsletter->label(), 'link' => $edit_link]);
    }

    $form_state->setRedirect('simplenews.newsletter_list');
  }

}
