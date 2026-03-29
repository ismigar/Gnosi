# File Delete

The File Delete module adds the ability to easily delete files —both private
and public— within Drupal administration.

It changes files from the `Permanent` status to the `Temporary` status. These
files will be deleted by Drupal during its cron runs.

If a file is registered as being used somewhere, the Module will not allow it
to be deleted.

For a full description of the module, visit the
[project page](https://www.drupal.org/project/file_delete).

Submit bug reports and feature suggestions, or track changes in the
[issue queue](https://www.drupal.org/project/issues/file_delete).

## Differences from core functionality

In https://www.drupal.org/project/drupal/issues/2949017 the functionality to
delete a file was added to Drupal core 10.1. This module essentially hijacks
the core route and uses its own form with additional functionality.

* Built in safeguard that won't delete a file that has usage.
* Option to delete form immediately, skipping core's file cleanup step.
* Option to force delete a file, skipping the built-in access check.
* Bulk plugins for doing mass deletions.


## Table of contents

- Requirements
- Installation
- Configuration
- Troubleshooting
- FAQ
- Maintainers


## Requirements

This module requires no modules outside of Drupal core.


## Installation

Install as you would normally install a contributed Drupal module. For further
information, see
[Installing Drupal Modules](https://www.drupal.org/docs/extending-drupal/installing-drupal-modules).


## Configuration

1. Configure the user permissions in *Administration » People » Permissions*
   - `Delete files`: Users with this permission will gain access to delete file 
     entities.
1. Add a Delete link to your Files View in *Administration » Structure » Views 
   » Files » Edit*
   - A new `Link to delete File` field should be available.
1. A Delete link should now be visible for files in *Administration » Content
   » Files*


## Troubleshooting

File is set to 'Temporary' but not getting deleted after a cron run:

- In Drupal, Temporary files generally kept for some time — default 6 hours —
before being deleted.
- You can configure this time in *Administration » Configuration » Media » File
  System*


## FAQ

**Q: Working with Drupal Media**

**A:** If you added an image to the website as a Drupal Media entity, you will have to
follow these steps.
1. **Important:** Confirm that this Media is not being used in your site.
1. Delete this Media entity in *Administration » Content » Media*
1. Now you can delete the file in *Administration » Content » Files*

> **Why is this the case?**
> 
> Drupal's File Usage system still needs some work. It does not correctly track
> all usages within Drupal. Most of the work related to this is being tracked
> in [this issue](https://www.drupal.org/project/drupal/issues/2821423)
> 
> Specific to Drupal Media, the work is being tracked in
> [this issue](https://www.drupal.org/project/drupal/issues/2835840)  


## Maintainers

- Jonny Eom - [jonnyeom](https://www.drupal.org/u/jonnyeom)