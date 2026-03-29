<?php

namespace Drupal\simplenews;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Simplenews subscriber entity interface.
 */
interface SubscriberInterface extends ContentEntityInterface {

  /**
   * Subscriber is blocked.
   */
  const INACTIVE = 0;

  /**
   * Subscriber is active.
   */
  const ACTIVE = 1;

  /**
   * Subscriber is unconfirmed.
   */
  const UNCONFIRMED = 2;

  /**
   * Returns the subscriber's status.
   *
   * @return int
   *   The subscriber's status: INACTIVE, ACTIVE or UNCONFIRMED.
   */
  public function getStatus();

  /**
   * Checks if the subscriber is active.
   *
   * @return bool
   *   TRUE if the subscriber's status is ACTIVE.
   */
  public function isActive();

  /**
   * Checks if the subscriber is confirmed.
   *
   * @return bool
   *   TRUE if the subscribers status is not UNCONFIRMED.
   */
  public function isConfirmed();

  /**
   * Sets the status of the subscriber.
   *
   * Warning: This function may return a different subscriber. Activating an
   * unconfirmed subscriber can cause it to be merged into another subscriber
   * and deleted.
   *
   * @param int $status
   *   The subscriber's status: INACTIVE, ACTIVE or UNCONFIRMED.
   *
   * @return $this
   */
  public function setStatus(int $status);

  /**
   * Returns the subscriber's email address.
   *
   * @return string
   *   The subscribers email address.
   */
  public function getMail();

  /**
   * Sets the subscriber's email address.
   *
   * @param string $mail
   *   The subscribers email address.
   *
   * @return $this
   */
  public function setMail(string $mail);

  /**
   * Returns corresponding user ID.
   *
   * @return int
   *   The corresponding user ID.
   */
  public function getUserId();

  /**
   * Returns corresponding User object, if any.
   *
   * @return \Drupal\user\UserInterface|null
   *   The corresponding User object, or NULL if the subscriber is not synced
   *   with a user.
   */
  public function getUser();

  /**
   * Returns the lang code.
   *
   * @return string
   *   The subscribers lang code.
   */
  public function getLangcode();

  /**
   * Sets the lang code.
   *
   * @param string $langcode
   *   The subscriber's lang code.
   *
   * @return $this
   */
  public function setLangcode(string $langcode);

  /**
   * Fill values from a user account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to fill from.
   * @param bool
   *   TRUE to copy shared and base fields, FALSE to copy only base fields.
   *
   * @return $this
   */
  public function fillFromAccount(AccountInterface $account, bool $shared_fields = TRUE);

  /**
   * Copy values to a user account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to copy to.
   *
   * @return $this
   */
  public function copyToAccount(AccountInterface $account);

  /**
   * Check if the subscriber has an active subscription to a certain newsletter.
   *
   * @param string $newsletter_id
   *   The ID of a newsletter.
   *
   * @return bool
   *   Returns TRUE if the subscriber has the subscription, otherwise FALSE.
   */
  public function isSubscribed(string $newsletter_id);

  /**
   * Check if the subscriber has an inactive subscription to a given newsletter.
   *
   * @param string $newsletter_id
   *   The ID of a newsletter.
   *
   * @return bool
   *   TRUE if the subscriber has the inactive subscription, otherwise FALSE.
   */
  public function isUnsubscribed(string $newsletter_id);

  /**
   * Get the ids of all subscribed newsletters.
   *
   * @return array
   *   Returns the ids of all newsletters the subscriber is subscribed.
   */
  public function getSubscribedNewsletterIds();

  /**
   * Add a subscription to a certain newsletter to the subscriber.
   *
   * @param string $newsletter_id
   *   The ID of a newsletter.
   *
   * @return $this
   */
  public function subscribe(string $newsletter_id);

  /**
   * Delete a subscription to a certain newsletter of the subscriber.
   *
   * @param string $newsletter_id
   *   The ID of a newsletter.
   *
   * @return $this
   */
  public function unsubscribe(string $newsletter_id);

  /**
   * Send a confirmation email if required.
   *
   * @return bool
   *   TRUE if a confirmation was sent.
   */
  public function sendConfirmation();

  /**
   * Load a simplenews newsletter subscriber object by mail.
   *
   * @param string $mail
   *   Subscriber e-mail address.
   * @param bool $create
   *   (optional) Whether to create a new subscriber if none exists. Defaults
   *   to FALSE.
   * @param string $default_langcode
   *   (optional) Langcode to set if a new subscriber is created.
   * @param bool $check_trust
   *   (optional) Whether to create a new subscriber if none exists. Defaults
   *   to FALSE.
   *
   * @return \Drupal\simplenews\SubscriberInterface
   *   Newsletter subscriber entity, FALSE if subscriber does not exist.
   */
  public static function loadByMail(string $mail, ?bool $create = FALSE, ?string $default_langcode = NULL, ?bool $check_trust = FALSE);

  /**
   * Load a simplenews newsletter subscriber object by uid.
   *
   * @param int $uid
   *   Subscriber user id.
   * @param bool $create
   *   (optional) Whether to create a new subscriber if none exists. Defaults
   *   to FALSE.
   * @param bool $confirmed
   *   (optional) Whether to return only a confirmed subscribers. Defaults to
   *   TRUE.
   *
   * @return \Drupal\simplenews\SubscriberInterface
   *   Newsletter subscriber entity, FALSE if subscriber does not exist.
   */
  public static function loadByUid(int $uid, ?bool $create = FALSE, ?bool $confirmed = TRUE);

}
