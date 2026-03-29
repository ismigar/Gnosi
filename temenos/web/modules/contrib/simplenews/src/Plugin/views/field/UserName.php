<?php

namespace Drupal\simplenews\Plugin\views\field;

use Drupal\user\Entity\User;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * Field handler to display username as a link.
 *
 * @ingroup views_field_handlers
 *
 * @ViewsField("simplenews_user_name")
 */
class UserName extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  protected function renderLink($data, ResultRow $values) {
    $uid = $this->getValue($values);
    if (!empty($uid)) {
      $account = User::load($uid);
      $username = [
        '#theme' => 'username',
        '#account' => $account,
      ];
      return $this->getRenderer()->render($username);
    }
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function render(ResultRow $values) {
    $value = $this->getValue($values);
    return $this->renderLink($this->sanitizeValue($value), $values);
  }

}
