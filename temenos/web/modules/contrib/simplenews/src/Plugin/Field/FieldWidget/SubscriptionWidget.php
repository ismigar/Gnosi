<?php

namespace Drupal\simplenews\Plugin\Field\FieldWidget;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\Plugin\Field\FieldWidget\OptionsButtonsWidget;
use Drupal\Core\Form\FormStateInterface;
use Drupal\simplenews\SubscriptionWidgetInterface;

/**
 * Plugin implementation of the 'simplenews_subscription_select' widget.
 *
 * @FieldWidget(
 *   id = "simplenews_subscription_select",
 *   label = @Translation("Select list"),
 *   field_types = {
 *     "entity_reference"
 *   },
 *   multiple_values = TRUE
 * )
 */
class SubscriptionWidget extends OptionsButtonsWidget implements SubscriptionWidgetInterface {

  /**
   * IDs of the newsletters available for selection.
   *
   * @var string[]
   */
  protected $newsletterIds;

  /**
   * {@inheritdoc}
   */
  public function setAvailableNewsletterIds(?array $newsletter_ids = NULL) {
    $this->newsletterIds = array_keys(simplenews_newsletter_get_visible());
    if (isset($newsletter_ids)) {
      $this->newsletterIds = array_intersect($newsletter_ids, $this->newsletterIds);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getAvailableNewsletterIds() {
    if (!isset($this->newsletterIds)) {
      $this->setAvailableNewsletterIds();
    }
    return $this->newsletterIds;
  }

  /**
   * {@inheritdoc}
   */
  protected function getOptions(FieldableEntityInterface $entity) {
    return array_intersect_key(parent::getOptions($entity), array_flip($this->getAvailableNewsletterIds()));
  }

  /**
   * {@inheritdoc}
   */
  public function massageFormValues(array $values, array $form, FormStateInterface $form_state) {
    // Preserve hidden options.
    $original = $form_state->getformObject()->getEntity()->getSubscribedNewsletterIds();
    $hidden = array_diff($original, $this->getAvailableNewsletterIds());
    return array_merge($values, $hidden);
  }

  /**
   * {@inheritdoc}
   */
  public static function isApplicable(FieldDefinitionInterface $field_definition) {
    return (($field_definition->getTargetEntityTypeId() == 'simplenews_subscriber') && $field_definition->getName() == 'subscriptions');
  }

}
