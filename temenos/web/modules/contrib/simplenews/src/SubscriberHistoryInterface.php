<?php

namespace Drupal\simplenews;

use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Simplenews subscriber history entity interface.
 */
interface SubscriberHistoryInterface extends ContentEntityInterface {

  /**
   * Returns the subscriber's email address at this point in history.
   *
   * @return string
   *   The subscribers email address.
   */
  public function getMail();

  /**
   * Returns the timestamp of this change.
   *
   * @return int
   *   The timestamp.
   */
  public function getTimestamp();

  /**
   * Returns the author of this change.
   *
   * @return \Drupal\user\UserInterface
   *   The author.
   */
  public function getAuthor();

  /**
   * Returns a human-readable description of the source of this change.
   *
   * @return string
   *   The source.
   */
  public function getSource();

  /**
   * Checks if the subscriber has a subscription at this point in history.
   *
   * @param string $newsletter_id
   *   The ID of a newsletter.
   *
   * @return bool
   *   TRUE if the subscriber has the subscription, otherwise FALSE.
   */
  public function isSubscribed(string $newsletter_id);

  /**
   * Get all subscribed newsletters at this point in history.
   *
   * @return array
   *   The ids of all newsletters to which the subscriber is subscribed.
   */
  public function getSubscribedNewsletterIds();

}
