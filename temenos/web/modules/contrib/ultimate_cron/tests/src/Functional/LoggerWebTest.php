<?php

namespace Drupal\Tests\ultimate_cron\Functional;

use Drupal\Tests\BrowserTestBase;
use Drupal\Tests\Traits\Core\CronRunTrait;

/**
 * Tests that scheduler plugins are discovered correctly.
 *
 * @group ultimate_cron
 */
class LoggerWebTest extends BrowserTestBase {

  use CronRunTrait;

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['ultimate_cron', 'ultimate_cron_logger_test'];

  /**
   * A user with permissions to administer and run cron jobs.
   *
   * @var \Drupal\user\Entity\User
   */
  protected $user;

  /**
   * Flag to control if errors should be ignored or not.
   *
   * @var bool
   */
  protected $ignoreErrors = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $defaultTheme = 'stark';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->user = $this->createUser([
      'administer ultimate cron',
      'view cron jobs',
      'run cron jobs',
    ]);
    $this->drupalLogin($this->user);
  }

  /**
   * Tests that the logger handles an exception correctly.
   */
  public function testLoggerException() {

    \Drupal::state()->set('ultimate_cron_logger_test_cron_action', 'exception');

    // Run cron to get an exception from ultimate_cron_logger_test module.
    $this->cronRun();

    // Check that the error message is displayed in its log page.
    $this->drupalGet('admin/config/system/cron/jobs/logs/ultimate_cron_logger_test_cron');
    $this->assertSession()->responseContains('/core/misc/icons/e32700/error.svg');
    $this->assertSession()->responseContains('<em class="placeholder">Exception</em>: Test cron exception in <em class="placeholder">ultimate_cron_logger_test_cron()</em> (line');
  }

  /**
   * Tests that the logger handles an exception correctly.
   */
  public function testLoggerFatal() {

    \Drupal::state()->set('ultimate_cron_logger_test_cron_action', 'fatal');

    // Run cron to get an exception from ultimate_cron_logger_test module.
    $this->ignoreErrors = TRUE;
    $this->cronRun();
    $this->ignoreErrors = FALSE;

    // Check that the error message is displayed in its log page.
    $this->drupalGet('admin/config/system/cron/jobs/logs/ultimate_cron_logger_test_cron');
    $this->assertSession()->responseContains('/core/misc/icons/e32700/error.svg');
    $this->assertSession()->responseContains('Call to undefined function call_to_undefined_function');

    // Empty the logfile, our fatal errors are expected.
    $filename = DRUPAL_ROOT . '/' . $this->siteDirectory . '/error.log';
    file_put_contents($filename, '');
  }

  /**
   * Tests that the logger handles long message correctly.
   */
  public function testLoggerLongMessage() {

    \Drupal::state()->set('ultimate_cron_logger_test_cron_action', 'long_message');

    // Run cron to get a long message log from ultimate_cron_logger_test.
    $this->cronRun();

    // Check that the long log message is properly trimmed.
    $this->drupalGet('admin/config/system/cron/jobs/logs/ultimate_cron_logger_test_cron');
    $xpath = $this->xpath('//table/tbody/tr/td[4]');
    // The last 2 chars from xpath are not related to the message.
    $this->assertTrue(strlen(substr($xpath[0]->getText(), 0, -2)) == 5000);
    $this->assertSession()->responseContains('This is a v…');
  }

  /**
   * Tests that the logger handles an exception correctly.
   */
  public function testLoggerLogWarning() {

    \Drupal::state()->set('ultimate_cron_logger_test_cron_action', 'log_warning');

    // Run cron to get an exception from ultimate_cron_logger_test module.
    $this->cronRun();

    // Check that the error message is displayed in its log page.
    $this->drupalGet('admin/config/system/cron/jobs/logs/ultimate_cron_logger_test_cron');
    $this->assertSession()->responseContains('/core/misc/icons/e29700/warning.svg');
    $this->assertSession()->responseContains('This is a warning message');
  }

  /**
   * Tests that the logger handles an exception correctly.
   */
  public function testLoggerNormal() {
    // Run cron to get an exception from ultimate_cron_logger_test module.
    $this->cronRun();

    // Check that the error message is displayed in its log page.
    $this->drupalGet('admin/config/system/cron/jobs/logs/ultimate_cron_logger_test_cron');
    $this->assertSession()->responseContains('/core/misc/icons/73b355/check.svg');
    $this->assertSession()->pageTextContains('Launched in thread 1');
  }

}
