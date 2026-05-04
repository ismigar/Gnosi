<?php

namespace Drupal\Tests\simplenews\Kernel;

use Drupal\KernelTests\KernelTestBase;

/**
 * Unit tests for certain functions.
 *
 * @group simplenews
 */
class SimplenewsKernelTest extends KernelTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = ['simplenews'];

  /**
   * Test mail masking function.
   */
  public function testMasking() {
    $this->assertEquals('t*****@e*****.org', simplenews_mask_mail('test@example.org'));
    $this->assertEquals('t*****@e*****.org', simplenews_mask_mail('t@example.org'));
    $this->assertEquals('t*****@t*****.org', simplenews_mask_mail('t@test.example.org'));
    $this->assertEquals('t*****@e*****', simplenews_mask_mail('t@example'));

  }

}
