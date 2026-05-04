# Ultimate Cron

The Ultimate Cron module runs cron jobs individually in parallel using
configurable rules, pool management and load balancing.

While this module replaces core's logic on how cron works, it does not control
how cron is actually initiated. It is recommended to use an external service or
command (e.g. `drush cron` via crontab) to initiate; see "Executing cron" below.

- For a full description of the module, visit the
  [project page](https://www.drupal.org/project/ultimate_cron)

- To submit bug reports and feature suggestions, or to track changes:
  [issue queue](https://www.drupal.org/project/issues/ultimate_cron)


## Requirements

This module requires no modules outside of Drupal core.


## Installation

Install the Ultimate Cron module as you would normally install a
contributed Drupal module. Visit
[Installing Drupal Modules](https://www.drupal.org/node/1897420) for further information.


## Configuration

The module expands core's single cron admin page (`admin/config/system/cron`)
with two additional pages - one for controlling each available cron task, and
another for controlling miscellaneous settings.


#### Cron jobs - admin/config/system/cron/jobs

This page provides a list of all available cron tasks, allows their execution
order to be controlled, and each one may be paused or executed individually,
should that be needed.


#### Cron settings - admin/config/system/cron/settings

This group of pages provides options for how cron is executed. Most of the
settings can be left as-is, but can provide additional control over how the cron
system works for advanced users.

## Executing cron

Running the Ultimate Cron system is as simple as running the standard Drupal
cron - Ultimate Cron will take over processing and control what is actually
executed. This simplifies the process and makes Ultimate Cron a drop-in
improvement over the standard system cron.

### Recommendations

- The cron system must be executed at least as often as the most frequent
  cron definition. For example, if the site's most frequent cron task needs to
  run every 5 minutes, then cron needs to be executed every 5 minutes.
- It is recommended to not use core's Automated Cron module. The most glaring
  reason is that the task is only executed by non-cached page requests, thus if
  a site is highly cached it may miss its execution window. Instead, use a
  reliable cron job system such as crontab or alternatives provided by most
  hosting providers.

## Queue handling

This module optionally allows to expose each queue worker as a separate job,
which allows control over how frequently they run. This is only necessary
if some queue workers should run less frequently than cron is being called.

## Troubleshooting

### Run cron on a loop

One approach to troubleshooting a problem with cron tasks is to run cron on a
loop, then pay attention to what cron tasks are being executed.

An easy way to run cron on a loop is using the Drush command via a `while` loop,
e.g. this will trigger an endless loop in bash and uses ddev to launch cron,
with a fifteen second pause between each loop:

    while true; do drush cron; sleep 15; done

A similar command using [FishShell](https://fishshell.com):

    while true; ddev drush cron; sleep 15; end

Use `command-C` to end the loop when finished.


## Logging

Each job has its own logging that contains information about executions and
any errors that happened during that job.


## Creating new cron tasks

To add a cron job you can use either hook_cron() or use configuration files with
custom parameters for multiple/additional cron jobs in a module.

The easiest way to declare a cron job is to use hook_cron() and clear caches. To
provide non-default configuration, export it and put it in your modules
`config/install` or `config/optional` directories as with any other config, this
step is optional.

To provide additional cron jobs, copy an existing job config entity, adjust
the callback and other settings, give it a unique id and adjusted filename and
import it or provide it as default configuration for your module.

Example config entity (ultimate_cron.job.my_module_ping.yml):
```
langcode: en
status: true
dependencies:
  module:
    - user
title: 'Pings users'
id: my_module_ping
module: my_module
callback: _my_module_user_ping_cron
scheduler:
  id: simple
  configuration:
    rules:
      - '*/5@ * * * *'
launcher:
  id: serial
  configuration:
    timeouts:
      lock_timeout: 3600
      max_execution_time: 3600
    launcher:
      max_threads: 1
logger:
  id: database
  configuration:
    method: '3'
    expire: 1209600
    retain: 1000
```


Example from the [simplenews module](https://cgit.drupalcode.org/simplenews/tree/config/optional/ultimate_cron.job.simplenews_cron.yml).

The following details of the cron job can be specified:

- **title**: The title of the cron job. If not provided, the
  name of the cron job will be used.
- **module**: The module where this job lives.
- **callback**: The callback to call when running the job.
- **scheduler**: Default scheduler (plugin type) for this job.
- **launcher**: Default launcher (plugin type) for this job.
- **logger**: Default logger (plugin type) for this job.

### Callback

The following formats are supported for the callback:
- A function
- A module hook, such as system#cron, this is invoked through the module handler
  and support modern #Hook implementations in Drupal 11.1+.
- A static method on a class with className::method
- A service method with service.name:method.
- The name of a class with an __invoke method.

## Maintainers

- Sascha Grossenbacher - [Berdir](https://www.drupal.org/u/berdir)
- Arne Jørgensen - [arnested](https://www.drupal.org/u/arnested)
- Thomas Gielfeldt - [gielfeldt](https://www.drupal.org/u/gielfeldt)
- Lukas Schneider - [LKS90](https://www.drupal.org/u/lks90)


### Supporting organizations

- [MD Systems](https://www.drupal.org/md-systems)
- [Reload!](https://www.drupal.org/reload)

Thanks to Mark James for the icons:

- [FamFamFam icons](http://www.famfamfam.com/lab/icons/silk/)
