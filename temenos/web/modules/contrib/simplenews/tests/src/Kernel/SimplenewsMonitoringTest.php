<?php

namespace Drupal\Tests\simplenews\Kernel;

use Drupal\KernelTests\KernelTestBase;

/**
 * Tests for simplenews sensor.
 *
 * @group simplenews
 * @dependencies monitoring
 */
class SimplenewsMonitoringTest extends KernelTestBase {

  /**
   * Modules to enable.
   *
   * @var array
   */
  protected static $modules = [
    'node', 'system', 'views', 'user', 'field', 'text', 'simplenews', 'options', 'monitoring', 'monitoring_test',
  ];

  /**
   * Tests individual sensors.
   */
  public function testSensors() {

    $this->installConfig(['system']);
    $this->installConfig(['node']);
    $this->installConfig(['simplenews']);
    $this->installEntitySchema('monitoring_sensor_result');
    $this->installSchema('simplenews', 'simplenews_mail_spool');

    // No spool items - status OK.
    $result = $this->runSensor('simplenews_pending');
    $this->assertEquals(0, $result->getValue());

    // Crate a spool item in state pending.
    \Drupal::service('simplenews.spool_storage')->addMail([
      'entity_type' => 'node',
      'entity_id' => 1,
      'newsletter_id' => 'default',
      'snid' => 1,
    ]);

    $result = $this->runSensor('simplenews_pending');
    $this->assertEquals(1, $result->getValue());
  }

  /**
   * Executes a sensor and returns the result.
   *
   * @param string $sensor_name
   *   Name of the sensor to execute.
   *
   * @return \Drupal\monitoring\Result\SensorResultInterface
   *   The sensor result.
   */
  protected function runSensor($sensor_name) {
    // Make sure the sensor is enabled.
    monitoring_sensor_manager()->enableSensor($sensor_name);
    return monitoring_sensor_run($sensor_name, TRUE, TRUE);
  }

}
