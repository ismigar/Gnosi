<?php

namespace Drupal\Tests\simplenews\Kernel;

use Drupal\language\Entity\ConfigurableLanguage;

/**
 * Test the tokens multilingual replacements.
 *
 * @group simplenews
 */
class SimplenewsTokensMultilingualTest extends SimplenewsTokensTest {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'token',
    'node',
    'user',
    'locale',
    'language',
    'simplenews',
  ];

  /**
   * The language manager.
   *
   * @var \Drupal\Core\Language\LanguageManagerInterface
   */
  protected $languageManager;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installConfig(['language']);
    $this->installSchema('locale', ['locales_source', 'locales_target', 'locales_location']);
    $this->installEntitySchema('configurable_language');

    $this->languageManager = $this->container->get('language_manager');

    // In order to reflect the changes for a multilingual site in the container
    // we have to rebuild it.
    ConfigurableLanguage::createFromLangcode('es')->save();

    $config = $this->config('language.negotiation');
    $config->set('url.prefixes', ['en' => 'en', 'es' => 'es'])->save();

    $this->container->get('kernel')->rebuildContainer();
  }

  /**
   * {@inheritdoc}
   *
   * @dataProvider simplenewsSubscriberActionUrlTokensDataProvider
   */
  public function testSimplenewsSubscriberActionUrlTokens($token, $action, $subscriber_langcode, $expected_uri_pattern) {
    parent::testSimplenewsSubscriberActionUrlTokens($token, $action, $subscriber_langcode, $expected_uri_pattern);
  }

  public function simplenewsSubscriberActionUrlTokensDataProvider() {
    // $token, $action, $subscriber_langcode, $expected_uri_pattern.
    return [
      ['unsubscribe-url', 'remove', NULL, 'base:/en/simplenews/remove/%subscriber_id/%newsletter_id/%request_time/%hash'],
      ['confirm-url', 'confirm', NULL, 'base:/en/simplenews/confirm/%subscriber_id/%request_time/%hash'],
      ['manage-url', 'manage', NULL, 'base:/en/simplenews/manage/%subscriber_id/%request_time/%hash'],
      ['unsubscribe-url', 'remove', 'es', 'base:/es/simplenews/remove/%subscriber_id/%newsletter_id/%request_time/%hash'],
      ['confirm-url', 'confirm', 'es', 'base:/es/simplenews/confirm/%subscriber_id/%request_time/%hash'],
      ['manage-url', 'manage', 'es', 'base:/es/simplenews/manage/%subscriber_id/%request_time/%hash'],
    ];
  }

  /**
   * {@inheritdoc}
   *
   * @dataProvider simplenewsNewsletterNameTokenDataProvider
   */
  public function testSimplenewsNewsletterNameToken($newsletter_name, $subscriber_langcode, $expected_name) {
    if ($subscriber_langcode === 'es') {
      if ($newsletter_name === 'Example') {
        $this->addTranslationForNewsletter($subscriber_langcode, 'Ejemplo');
      }

      $this->addTranslationForString('Unassigned newsletter', 'Boletín informativo no asignado', $subscriber_langcode);
    }

    parent::testSimplenewsNewsletterNameToken($newsletter_name, $subscriber_langcode, $expected_name);
  }

  /**
   * {@inheritdoc}
   */
  public function simplenewsNewsletterNameTokenDataProvider() {
    return [
      [NULL, NULL, 'Unassigned newsletter'],
      ['', NULL, 'Unassigned newsletter'],
      ['Example', NULL, 'Example'],
      [NULL, 'es', 'Boletín informativo no asignado'],
      ['', 'es', 'Boletín informativo no asignado'],
      ['Example', 'es', 'Ejemplo'],
    ];
  }

  /**
   * Adds translation for newsletter.
   *
   * @return void
   */
  protected function addTranslationForNewsletter($langcode, $name) {
    $translation = $this->languageManager->getLanguageConfigOverride($langcode, $this->newsletter->getConfigDependencyName());
    $translation->set('name', $name);
    $translation->save();
  }

  /**
   * Adds translation for strings.
   *
   * @return void
   */
  protected function addTranslationForString($source_string, $translated_string, $langcode) {
    $locale_storage = $this->container->get('locale.storage');
    $source = $locale_storage->findString(['source' => $source_string]);
    if ($source === NULL) {
      $source = $locale_storage->createString([
        'source' => $source_string,
      ])->save();
    }

    $locale_storage->createTranslation([
      'lid' => $source->lid,
      'language' => $langcode,
      'translation' => $translated_string,
    ])->save();
  }

}
