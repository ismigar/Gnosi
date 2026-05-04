<?php

namespace Drupal\simplenews\Subscription;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\simplenews\Entity\Subscriber;
use Drupal\simplenews\SubscriberInterface;

/**
 * Default subscription manager.
 */
class SubscriptionManager implements SubscriptionManagerInterface {

  /**
   * The language manager.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;

  /**
   * Configuration.
   *
   * @var \Drupal\Core\Config\ImmutableConfig
   */
  protected $config;

  /**
   * The route match.
   *
   * @var \Drupal\Core\Routing\RouteMatchInterface
   */
  protected $routeMatch;

  /**
   * The time service.
   *
   * @var \Drupal\Component\Datetime\TimeInterface
   */
  protected $time;

  /**
   * The current user service.
   *
   * @var \Drupal\Core\Session\AccountInterface
   */
  protected $currentUser;

  /**
   * The subscriber storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $subscriberStorage;

  /**
   * The subscriber history storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface
   */
  protected $historyStorage;

  /**
   * Constructs a SubscriptionManager.
   *
   * @param \Drupal\Core\Language\LanguageManagerInterface $language_manager
   *   The language manager.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager service.
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The route match.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The time service.
   * @param \Drupal\Core\Session\AccountInterface $current_user
   *   The current user.
   */
  public function __construct(LanguageManagerInterface $language_manager, ConfigFactoryInterface $config_factory, EntityTypeManagerInterface $entity_type_manager, RouteMatchInterface $route_match, TimeInterface $time, AccountInterface $current_user) {
    $this->languageManager = $language_manager;
    $this->config = $config_factory->get('simplenews.settings');
    $this->routeMatch = $route_match;
    $this->time = $time;
    $this->currentUser = $current_user;
    $this->subscriberStorage = $entity_type_manager->getStorage('simplenews_subscriber');
    $this->historyStorage = $entity_type_manager->getStorage('simplenews_subscriber_history');
  }

  /**
   * {@inheritdoc}
   */
  public function subscribe(string $mail, string $newsletter_id, ?string $preferred_langcode = NULL) {
    if (func_num_args() > 3) {
      throw new \LogicException('Only 3 arguments are supported');
    }

    // Get/create subscriber entity.
    $preferred_langcode = $preferred_langcode ?? $this->languageManager->getCurrentLanguage()->getId();
    $subscriber = Subscriber::loadByMail($mail, 'create', $preferred_langcode);
    $subscriber->subscribe($newsletter_id)->save();
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function unsubscribe(string $mail, string $newsletter_id) {
    if (func_num_args() > 2) {
      throw new \LogicException('Only 2 arguments are supported');
    }

    if ($subscriber = Subscriber::loadByMail($mail)) {
      // Unsubscribe the user from the mailing list.
      $subscriber->unsubscribe($newsletter_id)->save();
    }
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function isSubscribed(string $mail, string $newsletter_id) {
    $subscriber = Subscriber::loadByMail($mail);
    // Check that a subscriber was found, it is active and subscribed to the
    // requested newsletter_id.
    return $subscriber && $subscriber->isActive() && $subscriber->isSubscribed($newsletter_id);
  }

  /**
   * {@inheritdoc}
   */
  public function hasSubscribed(string $mail, string $newsletter_id) {
    $found = $this->historyStorage->getQuery()
      ->condition('mail', $mail)
      ->condition('subscriptions.target_id', $newsletter_id, 'IN')
      ->accessCheck(FALSE)
      ->range(0, 1)
      ->count()
      ->execute();

    return $found > 0;
  }

  /**
   * {@inheritdoc}
   */
  public function trackHistory(SubscriberInterface $subscriber) {
    if (!$subscriber->isConfirmed()) {
      // Ignore: not confirmed.
      return;
    }

    if (isset($subscriber->original) && $subscriber->original->isConfirmed()) {
      if (($subscriber->get('mail')->getValue() == $subscriber->original->get('mail')->getValue()) && ($subscriber->get('subscriptions')->getValue() == $subscriber->original->get('subscriptions')->getValue())) {
        // Ignore: no changes.
        return;
      }
    }

    $values = [
      'mail' => $subscriber->getMail(),
      'timestamp' => $this->time->getRequestTime(),
      'uid' => $this->currentUser->id(),
      'source' => 'route:' . $this->routeMatch->getRouteName(),
      'subscriptions' => $subscriber->getSubscribedNewsletterIds(),
    ];

    $this->historyStorage->create($values)->save();
  }

  /**
   * {@inheritdoc}
   */
  public function tidy() {
    $days = $this->config->get('subscription.tidy_unconfirmed');
    if (!$days) {
      return;
    }

    // Query unconfirmed subscribers.
    $max_age = strtotime("-$days days");
    $unconfirmed = \Drupal::entityQuery('simplenews_subscriber')
      ->condition('status', SubscriberInterface::UNCONFIRMED)
      ->condition('created', $max_age, '<')
      ->accessCheck(FALSE)
      ->execute();

    $this->subscriberStorage->delete($this->subscriberStorage->loadMultiple($unconfirmed));
  }

  /**
   * {@inheritdoc}
   */
  public function getsubscriptionsUrl() {
    $user = $this->currentUser;
    if ($user->isAuthenticated()) {
      return Url::fromRoute('simplenews.newsletter_subscriptions_user', ['user' => $user->id()]);
    }
    return Url::fromRoute('simplenews.subscriptions_validate');
  }

}
