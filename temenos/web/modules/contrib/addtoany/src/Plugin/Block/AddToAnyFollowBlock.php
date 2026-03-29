<?php

namespace Drupal\addtoany\Plugin\Block;

use Drupal\Core\Block\BlockBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Provides an 'AddToAny follow' block.
 *
 * @Block(
 *   id = "addtoany_follow_block",
 *   admin_label = @Translation("AddToAny follow buttons"),
 * )
 */
class AddToAnyFollowBlock extends BlockBase {

  /**
   * {@inheritdoc}
   */
  public function build() {
    $build = [];

    $data = addtoany_create_data();

    $buttons_size = $this->configuration['buttons_size'] ?: $data['buttons_size'];
    $addtoany_html = $this->configuration['addtoany_html'];

    $build = [
      '#addtoany_html' => addtoany_strip_whitespace($addtoany_html),
      '#buttons_size' => $buttons_size,
      '#theme' => 'addtoany_follow',
    ];

    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    return [
      'buttons_size' => '',
      'addtoany_html' => '',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function blockForm($form, FormStateInterface $form_state) {
    $attributes_for_code = [
      'autocapitalize' => ['off'],
      'autocomplete' => ['off'],
      'autocorrect' => ['off'],
      'spellcheck' => ['false'],
    ];

    $form['addtoany_options'] = [
      '#type'         => 'details',
      '#title'        => $this->t('AddToAny options'),
      '#open'         => TRUE,
    ];

    $form['addtoany_options']['buttons_size'] = [
      '#type'          => 'number',
      '#title'         => $this->t('Icon size'),
      '#field_suffix'  => ' ' . $this->t('pixels'),
      '#default_value' => $this->configuration['buttons_size'],
      '#size'          => 10,
      '#maxlength'     => 3,
      '#min'           => 8,
      '#max'           => 999,
      '#placeholder'   => ['32'],
    ];

    $example_html = '<br /> <code>&lt;a class=&quot;a2a_button_facebook&quot; href=&quot;https://www.facebook.com/AddToAny&quot;&gt;&lt;/a&gt;<br />&lt;a class=&quot;a2a_button_mastodon&quot; href=&quot;https://mastodon.social/@Gargron&quot;&gt;&lt;/a&gt;<br />&lt;a class=&quot;a2a_button_youtube&quot; href=&quot;https://www.youtube.com/@YouTube&quot;&gt;&lt;/a&gt;</code>';

    $form['addtoany_options']['addtoany_html'] = [
      '#required'      => TRUE,
      '#type'          => 'textarea',
      '#title'         => $this->t('Service Buttons HTML code'),
      '#default_value' => $this->configuration['addtoany_html'],
      '#description'   => $this->t('Add HTML code to display <a href="https://www.addtoany.com/buttons/customize/drupal/follow_buttons" target="_blank">follow buttons</a> that link to your social media profiles. For example:') . $example_html,
      '#disabled'      => !\Drupal::currentUser()->hasPermission('administer addtoany'),
      '#attributes' => $attributes_for_code,
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function blockSubmit($form, FormStateInterface $form_state) {
    $options = $form_state->getValue('addtoany_options');
    $this->configuration['buttons_size'] = $options['buttons_size'];
    $this->configuration['addtoany_html'] = $options['addtoany_html'];
  }

}
