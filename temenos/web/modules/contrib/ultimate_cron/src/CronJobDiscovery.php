<?php

namespace Drupal\ultimate_cron;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Extension\ModuleExtensionList;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Queue\QueueWorkerManagerInterface;
use Drupal\ultimate_cron\Entity\CronJob;

/**
 * Discovery and instantiation of default cron jobs.
 */
class CronJobDiscovery {

  /**
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * @var \Drupal\Core\Queue\QueueWorkerManagerInterface
   */
  protected $queueManager;

  /**
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected $configFactory;

  /**
   * The module extension list service.
   *
   * @var \Drupal\Core\Extension\ModuleExtensionList
   */
  protected $moduleExtensionList;

  /**
   * CronJobDiscovery constructor.
   *
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler.
   * @param \Drupal\Core\Queue\QueueWorkerManagerInterface $queue_manager
   *   The queue manager.
   * @param \Drupal\Core\Extension\ModuleExtensionList $module_extension_list
   *   The module extension list service.
   */
  public function __construct(ModuleHandlerInterface $module_handler, QueueWorkerManagerInterface $queue_manager, ConfigFactoryInterface $config_factory, ModuleExtensionList $module_extension_list) {
    $this->moduleHandler = $module_handler;
    $this->queueManager = $queue_manager;
    $this->configFactory = $config_factory;
    $this->moduleExtensionList = $module_extension_list;
  }

  /**
   * Automatically discovers and creates default cron jobs.
   */
  public function discoverCronJobs() {
    // Create cron jobs for hook_cron() implementations.
    foreach ($this->getHooks() as $id => $info) {
      $this->ensureCronJobExists($info, $id);
    }

    if (!$this->configFactory->get('ultimate_cron.settings')->get('queue.enabled')) {
      return;
    }

    // Create cron jobs for queue plugins.
    foreach ($this->queueManager->getDefinitions() as $id => $definition) {
      if (!isset($definition['cron'])) {
        continue;
      }

      $job_id = str_replace(':', '__', CronJobInterface::QUEUE_ID_PREFIX . $id);
      if (!CronJob::load($job_id)) {
        $values = [
          'title' => t('Queue: @title', ['@title' => $definition['title']]),
          'id' => $job_id,
          'module' => $definition['provider'],
          // Process queue jobs later by default.
          'weight' => 10,
          'callback' => 'ultimate_cron.queue_worker:queueCallback',
          'scheduler' => [
            'id' => 'simple',
            'configuration' => [
              'rules' => ['* * * * *'],
            ],
          ]
        ];

        $job = CronJob::create($values);
        $job->save();
      }
    }
  }

  /**
   * Creates a new cron job with specific values.
   *
   * @param array $info
   *   Module info.
   * @param string $id
   *   Module name.
   */
  protected function ensureCronJobExists($info, $id) {
    $job = NULL;
    if (!CronJob::load($id)) {
      $values = array(
        'title' => $this->getJobTitle($id),
        'id' => $id,
        'module' => $info['module'],
        'callback' => $info['callback'],
      );

      $job = CronJob::create($values);

      $job->save();
    }
  }

  /**
   * Returns the job title for a given ID.
   *
   * @param string $id
   *   The default cron job ID.
   *
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup
   *   The default job title.
   */
  protected function getJobTitle($id) {
    $titles = array();

    $titles['aggregator_cron'] = t('Refresh feeds');
    $titles['comment_cron'] = t('Store the maximum possible comments per thread');
    $titles['dblog_cron'] = t('Remove expired log messages and flood control events');
    $titles['field_cron'] = t('Purge deleted Field API data');
    $titles['file_cron'] = t('Delete temporary files');
    $titles['history_cron'] = t('Delete history');
    $titles['layout_builder_cron'] = t('Remove unused inline block entity operations');
    $titles['locale_cron'] = t('Update translations');
    $titles['node_cron'] = t('Update search rankings for nodes');
    $titles['search_cron'] = t('Update indexable active search pages');
    $titles['statistics_cron'] = t('Reset counts and clean up');
    $titles['system_cron'] = t('Cleanup (caches, batch, flood, temp-files, etc.)');
    $titles['tracker_cron'] = t('Update tracker index');
    $titles['update_cron'] = t('Check for updates');
    $titles['workspaces_cron'] = t('Purge deleted workspaces');

    // Contrib modules.
    $titles['backup_migrate_cron'] = t('Run scheduled backups');
    $titles['captcha_cron'] = t('Remove old sessions');
    $titles['content_lock_timeout_cron'] = t('Release stale locks');
    $titles['core_event_dispatcher_cron'] = t('Dispatch cron events');
    $titles['flysystem_cron'] = t('Check the sanity of installed filesystems');
    $titles['hook_event_dispatcher_cron'] = t('Dispatch cron events');
    $titles['mailchimp_cron'] = t('Send queued (un)subscribe actions to Mailchimp');
    $titles['password_policy_cron'] = t('Indicate expired passwords for users');
    $titles['preview_link_cron'] = t('Delete expired preview links');
    $titles['purge_processor_cron_cron'] = t('Invalidate cache items');
    $titles['redirect_404_cron'] = t('Delete old 404 errors');
    $titles['scheduler_cron'] = t('(Un)publish scheduled entities');
    $titles['search_api_cron'] = t('Execute pending server tasks and update indexes');
    $titles['search_api_solr_cron'] = t('Optimize Solr servers');
    $titles['simple_oauth_cron'] = t('Delete expired tokens');
    $titles['simple_sitemap_cron'] = t('Generate sitemaps');
    $titles['simple_sitemap_engines_cron'] = t('Submit sitemaps to search engines');
    $titles['ultimate_cron_cron'] = t('Run internal cleanup operations');
    $titles['webform_cron'] = t('Purge old submissions');
    $titles['webform_scheduled_email_cron'] = t('Sends scheduled emails for submissions');
    $titles['xmlsitemap_cron'] = t('Regenerate XML sitemaps');
    $titles['xmlsitemap_engines_cron'] = t('Submit XML sitemaps to search engines');

    if (isset($titles[$id])) {
      return $titles[$id];
    }
    return t('Default cron handler');
  }

  /**
   * Get all cron hooks defined.
   *
   * @return array
   *   All hook definitions available.
   */
  protected function getHooks() {
    $hooks = array();
    // Generate list of jobs provided by modules.
    $modules = array_keys($this->moduleHandler->getModuleList());
    foreach ($modules as $module) {
      $hooks += $this->getModuleHooks($module);
    }

    return $hooks;
  }

  /**
   * Get cron hooks declared by a module.
   *
   * @param string $module
   *   Name of module.
   *
   * @return array
   *   Hook definitions for the specified module.
   */
  protected function getModuleHooks($module) {
    $items = array();

    // Add hook_cron() if applicable.
    if (method_exists($this->moduleHandler, 'hasImplementations')) {
      $has_implementations = $this->moduleHandler->hasImplementations('cron', $module);
    }
    else {
      $has_implementations = $this->moduleHandler->implementsHook($module, 'cron');
    }
    if ($has_implementations) {
      $info = $this->moduleExtensionList->getExtensionInfo($module);
      $id = "{$module}_cron";
      $items[$id] = [
        'module' => $module,
        'title' => isset($titles[$id]) ? $titles[$id] : 'Default cron handler',
        'configure' => empty($info['configure']) ? NULL : $info['configure'],
        'callback' => "{$module}#cron",
        'tags' => ['core'],
        'pass job argument' => FALSE,
      ];
    }

    return $items;
  }

}

