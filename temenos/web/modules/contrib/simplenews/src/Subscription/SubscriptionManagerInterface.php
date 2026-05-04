<?php

namespace Drupal\simplenews\Subscription;

use Drupal\simplenews\SubscriberInterface;

/**
 * Subscription management; subscribe, unsubscribe and get subscription status.
 */
interface SubscriptionManagerInterface {

  /**
   * Subscribe a user to a newsletter.
   *
   * @param string $mail
   *   The email address to subscribe to the newsletter.
   * @param string $newsletter_id
   *   The newsletter ID.
   * @param string $preferred_langcode
   *   The language code (i.e. 'en', 'nl') of the user preferred language.
   *   Use '' for the site default language.
   *   Use NULL for the language of the current page.
   *
   * @return $this
   */
  public function subscribe(string $mail, string $newsletter_id, ?string $preferred_langcode = NULL);

  /**
   * Unsubscribe a user from a newsletter.
   *
   * @param string $mail
   *   The email address to unsubscribe from the mailing list.
   * @param string $newsletter_id
   *   The newsletter ID.
   *
   * @return $this
   */
  public function unsubscribe(string $mail, string $newsletter_id);

  /**
   * Check if the email address is subscribed to the given mailing list.
   *
   * @param string $mail
   *   The email address to be checked.
   * @param string $newsletter_id
   *   The mailing list id.
   *
   * @return bool
   *   TRUE if the email address is subscribed; otherwise false.
   *
   * @ingroup subscription
   *
   * @todo Caching should be done in simplenews_load_user_by_mail().
   */
  public function isSubscribed(string $mail, string $newsletter_id);

  /**
   * Checks is a subscriber has ever subscribed to a newsletter.
   *
   * @param string $mail
   *   The email address of the subscriber.
   * @param string $newsletter_id
   *   The newsletter ID.
   *
   * @return bool
   *   TRUE if the subscriber has ever subscribed.
   */
  public function hasSubscribed(string $mail, string $newsletter_id);

  /**
   * Tracks history for a subscriber that has just been saved.
   *
   * @param \Drupal\simplenews\SubscriberInterface $subscriber
   *   The subscriber.
   */
  public function trackHistory(SubscriberInterface $subscriber);

  /**
   * Tidy unconfirmed subscriptions.
   */
  public function tidy();

  /**
   * Gets an appropriate URL for showing subscriber subscriptions.
   *
   * Returns the 'Newsletters' tab for authenticated users or the 'Access
   * your subscriptions' page otherwise.
   *
   * @return \Drupal\Core\Url
   *   URL for the correct page.
   */
  public function getsubscriptionsUrl();

}
