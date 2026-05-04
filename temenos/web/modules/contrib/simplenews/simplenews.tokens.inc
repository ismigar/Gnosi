<?php

/**
 * @file
 * Token related hook implementations.
 */

use Drupal\Component\Utility\Html;
use Drupal\Core\Render\BubbleableMetadata;

/**
 * Implements hook_token_info().
 */
function simplenews_token_info() {
  $types['simplenews-subscriber'] = [
    'name' => t('Simplenews subscriber'),
    'description' => t('Tokens related to the newsletter recipient'),
    'needs-data' => 'simplenews_subscriber',
  ];
  $types['simplenews-newsletter'] = [
    'name' => t('Simplenews newsletter'),
    'description' => t('Tokens related to the newsletter'),
    'needs-data' => 'newsletter',
  ];

  // Tokens for simplenews subscriber.
  $subscriber['unsubscribe-url'] = [
    'name' => t('Unsubscribe URL'),
    'description' => t('The URL of the page to remove a subscription. For immediate removal, put "/ok" after the token.'),
  ];
  $subscriber['manage-url'] = [
    'name' => t('Manage URL'),
    'description' => t('The URL of the page where the subscribers can manage their newsletter subscriptions.'),
  ];
  $subscriber['confirm-url'] = [
    'name' => t('Subscribe confirmation URL'),
    'description' => t('The URL of the page where subscribers can confirm their subscription changes. For immediate confirmation, put "/ok" after the token.'),
  ];
  $subscriber['mail'] = [
    'name' => t('Subscriber email'),
    'description' => t('The email address of the newsletter receiver.'),
  ];

  $subscriber['user'] = [
    'name' => t('Corresponding user'),
    'description' => t('The user object that corresponds to this subscriber. This is not set for anonymous subscribers.'),
    'type' => 'user',
  ];

  // Tokens for simplenews newsletter.
  $newsletter['name'] = [
    'name' => t('Newsletter'),
    'description' => t('The name of the newsletter.'),
  ];
  $newsletter['url'] = [
    'name' => t('Newsletter URL'),
    'description' => t('The URL of the page listing the issues of this newsletter.'),
  ];

  return [
    'types' => $types,
    'tokens' => [
      'simplenews-subscriber' => $subscriber,
      'simplenews-newsletter' => $newsletter,
    ],
  ];
}

/**
 * Implements hook_tokens().
 */
function simplenews_tokens($type, $tokens, $data, $options, BubbleableMetadata $bubbleable_metadata) {
  $replacements = [];

  switch ($type) {
    case 'simplenews-subscriber':
      if (!isset($data['simplenews_subscriber'])) {
        return $replacements;
      }

      /** @var \Drupal\simplenews\Entity\Subscriber $subscriber */
      $subscriber = $data['simplenews_subscriber'];
      $newsletter = $data['newsletter'] ?? NULL;

      foreach ($tokens as $name => $original) {
        switch ($name) {
          case 'unsubscribe-url':
            if (!$newsletter || !$subscriber->id()) {
              break;
            }
            $bubbleable_metadata->setCacheMaxAge(0);
            $replacements[$original] = simplenews_generate_url($subscriber, 'remove', $newsletter);
            break;

          case 'combined-url':
            @trigger_error("Token 'combined-url' is deprecated in simplenews:4.0.0 and is removed from symfony_mailer:5.0.0. Instead you should use 'confirm-url'. See https://www.drupal.org/node/3356308", E_USER_DEPRECATED);
          case 'confirm-url':
            $bubbleable_metadata->setCacheMaxAge(0);
            $replacements[$original] = simplenews_generate_url($subscriber, 'confirm');
            break;

          case 'manage-url':
            if (!$subscriber->id()) {
              break;
            }
            $bubbleable_metadata->setCacheMaxAge(0);
            $replacements[$original] = simplenews_generate_url($subscriber, 'manage');
            break;

          case 'mail':
            $replacements[$original] = Html::escape($subscriber->getMail());
            break;
        }
      }

      if (($user_tokens = \Drupal::token()->findWithPrefix($tokens, 'user')) && !empty($subscriber->uid)) {
        $replacements += \Drupal::token()->generate('user', $user_tokens, ['user' => $subscriber->getUser()], $options, $bubbleable_metadata);
      }

      break;

    case 'simplenews-newsletter':
      $newsletter = $data['newsletter'] ?? NULL;
      if (!isset($newsletter)) {
        return $replacements;
      }

      $language_manager = \Drupal::languageManager();
      foreach ($tokens as $name => $original) {
        switch ($name) {
          case 'name':
            $current_langcode = $language_manager->isMultilingual()
              ? $language_manager->getCurrentLanguage()->getId()
              : NULL;
            // The $options['langcode'] already respects the subscriber's preferred language.
            // @see \Drupal\simplenews\Mail\MailEntity::getLanguage.
            $subscriber_langcode = $options['langcode'] ?? $current_langcode;

            if (!empty($newsletter->name)) {
              $newsletter_name = $newsletter->name;
              if ($language_manager->isMultilingual() && $subscriber_langcode !== $current_langcode) {
                $config_name = 'simplenews.newsletter.' . $newsletter->id;
                $translation = $language_manager->getLanguageConfigOverride($subscriber_langcode, $config_name);
                $newsletter_name = $translation->get('name') ?? $newsletter_name;
              }

              $replacements[$original] = $newsletter_name;
            }
            else {
              $replacements[$original] = t('Unassigned newsletter', [], ['langcode' => $subscriber_langcode]);
            }
            break;
        }
      }
      break;
  }

  return $replacements;
}
