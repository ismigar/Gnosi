<?php

namespace Drupal\simplenews\Plugin\migrate\source\d7;

use Drupal\migrate_drupal\Plugin\migrate\source\DrupalSqlBase;

/**
 * Migration source for Newsletter entities in D7.
 *
 * @MigrateSource(
 *   id = "simplenews_newsletter",
 *   source_module = "simplenews"
 * )
 */
class Newsletter extends DrupalSqlBase {

  /**
   * {@inheritdoc}
   */
  public function fields() {
    return [
      'newsletter_id' => $this->t('Newsletter ID'),
      'name' => $this->t('Name'),
      'description' => $this->t('Description'),
      'format' => $this->t('HTML or plaintext'),
      'priority' => $this->t('Priority'),
      'receipt' => $this->t('Request read receipt'),
      'from_name' => $this->t('Name of the e-mail author'),
      'email_subject' => $this->t('Newsletter subject'),
      'from_address' => $this->t('E-mail author address'),
      'hyperlinks' => $this->t('Indicates if hyperlinks should be kept inline or extracted'),
      'new_account' => $this->t('Indicates how to integrate with the register form'),
      'opt_inout' => $this->t('Defines the Opt-In/out options'),
      'block' => $this->t('TRUE if a block should be provided for this newsletter'),
      'weight' => $this->t('Weight of the newsletter when displayed in listings'),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getIds() {
    $version = $this->getModuleSchemaVersion('simplenews');
    if ($version >= 7000 & $version < 7200) {
      return ['tid' => ['type' => 'integer', 'alias' => 'c']];
    }
    else {
      return ['newsletter_id' => ['type' => 'integer']];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function query() {
    $version = $this->getModuleSchemaVersion('simplenews');
    if ($version >= 7000 & $version < 7200) {
      return $this->query71();
    }
    else {
      return $this->query72();
    }
  }

  /**
   * Get query for Simplenews module version 7.x-1.x.
   */
  protected function query71() {
    $q = $this->select('simplenews_category', 'c');
    $q->innerJoin('taxonomy_term_data', 't', 't.tid = c.tid');
    $q->fields('c', [
      'tid', 'format', 'priority', 'receipt', 'from_name', 'email_subject', 'from_address', 'hyperlinks', 'new_account', 'opt_inout', 'block',
    ]);
    $q->fields('t', ['name', 'description', 'weight']);
    $q->orderBy('c.tid');

    return $q;
  }

  /**
   * Get query for Simplenews module version 7.x-2.x.
   */
  protected function query72() {
    return $this->select('simplenews_newsletter', 'n')
      ->fields('n')
      ->orderBy('newsletter_id');
  }

}
