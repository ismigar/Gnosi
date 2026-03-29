Core does not support a delete_ui yet http://drupal.org/node/2949017.

This module adds the capability to delete files from the file admin view (UI). It assumes that the admin knows what they are doing and trusts that when they want to delete a file (even one with a non zero usage count) that they really want to remove the file. When removing files that are referenced by other entities, core takes care of removing the reference.

This capability was previously provided by http://drupal.org/project/file_entity but when media went into core in Drupal 8.4, file_entity was no longer recommended (read the project page). We can delete media entities but we can't actually delete files.

The general philosophy seems to be that files are not first class entities, that they are always attached to something, and that they only get deleted when that something is deleted. However, because of various bugs in core (see http://drupal.org/node/2821423), automatic file deletion was removed (see http://drupal.org/node/2891902). So we no longer delete files that are in use. But we also have no way for an admin to remove files that they know are not in use.

This modules recreates the minimal parts from http://drupal.org/project/file_entity to provide delete access and an admin UI by doing the following:

* adds an admin permission to 'delete any file'
* ensures that the file entity supports delete by adding the core entity delete template; this allows core to add an entity operations field
* adds the entity operations field to the file admin view; this is done as configuration, so it can easily change it to the 'delete' link if you prefer.

There are several contrib solutions, none do exactly what this module does:

* https://www.drupal.org/project/file_delete
* https://www.drupal.org/project/delete_files
* https://www.drupal.org/project/fancy_file_delete
* https://www.drupal.org/project/force_file_delte
