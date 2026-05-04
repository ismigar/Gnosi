# Multilingual Menu Links

The "link" field for menu items is not translatable. This is fine
for internal links since Drupal knows which version to reference
automatically.

This can be a problem for external links, as there might be a need
to provide a different URL based on the link language.

This module creates a "Provide Translated External Link" option in
the menu link form for translated items.

When enabled, it replaces the Link and Title fields with versions
that are language specific.

The current recommendation is to create language specific menus.
This module eliminates the need for that.

### Requirements

No special requirements. Requires menu_link_content from Drupal core.

### Install

Install module via composer or via standard Drupal module install
practices.

```bash
composer require drupal/multilingual_menu_urls
```

Enable via Drush:

```bash
drush en multilingual_menu_urls
```

### Usage

* Install and enable module.
* Make Custom menu link translatable (admin/config/regional/content-language).
* Exclude "Provide Translated External Link" & "Translated Link" from
being translated.
* Add menu link to a menu for default language and set external link.
* Translate menu link for another language and you should
"Provide Translated External Link" checkbox.
* Check the box and provided the translated information as needed.
* Save menu item.
* Test out menu links in the translated languages.

### Maintainers

* Ben Mullins (bnjmnm) - https://www.drupal.org/u/bnjmnm
* Shashank Kumar (shashank5563) - https://www.drupal.org/u/shashank5563
