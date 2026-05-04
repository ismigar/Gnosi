
DESCRIPTION
-----------

Simplenews publishes and sends newsletters to lists of subscribers. Both
anonymous and authenticated users can opt-in to different mailing lists.
HTML email can be sent by adding Mime mail module.


REQUIREMENTS
------------

 * For large mailing lists, cron is required.
 * HTML-format newsletters and/or newsletters with file attachments require the
   mime mail or HMTL mail module.
 * When sending newsletters on regular cron (cron.php), it is important that
   the base url (settings.php, variable $base_url) is set correctly or links
   inside the newsletter will not work. See the Tips (13.) below.
 * Additionally when using Drush to start cron, it is important to use the
   argument --uri=http://www.example.com


INSTALLATION
------------

 1. CREATE DIRECTORY

    Create a new directory "simplenews" in the sites/all/modules directory and
    place the entire contents of this simplenews folder in it.

 2. ENABLE THE MODULE

    Enable the module on the Modules admin page.

 3. ACCESS PERMISSION

    Grant the access at the Access control page:
      People > Permissions.

 4. CONFIGURE SIMPLENEWS

    Configure Simplenews on the Simplenews admin pages:
      Configuration > Simplenews.

    Enable new content types to use as newsletter:
      Structure > edit content type > Publishing options

    Add and configure newsletter categories:
      Structure > Web Services > Newsletters > Add newsletter category
      Structure > Web Services > Newsletters > edit newsletter category

 5. ENABLE SIMPLENEWS BLOCK

    With the Simplenews block users can subscribe to a newsletter.

    Enable a Simplenews block per Newsletter category:
      Structure > Newsletters > edit newsletter category

 6. CONFIGURE SIMPLENEWS BLOCK

    Configure the Simplenews block on the Block configuration page. You reach
    this page from Block admin page (Structure > Blocks).
    Click the 'Configure' link of the appropriate simplenews block.

    Permission "subscribe to newsletters" is required to view the subscription
    form in the simplenews block or to view the link to the subscription form.

 7. SIMPLENEWS BLOCK THEMING

    More control over the content of simplenews blocks can be achieved using
    the block theming. Theme your simplenews block by copying
    simplenews-block.html.twig into your theme directory and edit the content.
    The file is self documented listing all available variables.

    The newsletter block can be themed generally and per newsletter:
      simplenews-block.html.twig (for all newsletters)
      simplenews-block.tpl--[tid].php (for newsletter series tid)

 8. MULTILINGUAL SUPPORT

    Simplenews supports multilingual newsletters for node translation and url
    path prefixes.

    When translated newsletter issues are available subscribers receive the
    newsletter in their preferred language (according to account setting).
    Translation module is required for newsletter translation.

    Path prefixes are added to footer message according to the subscribers
    preferred language.

    The preferred language of anonymous users is set based on the interface
    language of the page they visit for subscription. Anonymous users can NOT
    change their preferred language. Users with an account on the site will be
    subscribed with the preferred language as set in their account settings.

    The confirmation mails can be translated by enableding the Simplenews
    variables at:
      Home > Administration > Configuration > Regional and language > Multilingual settings > Variables
    Afterwards, the mail subject and body can be entered for every enabled
    language.

9.  NEWSLETTER THEMING

    You can customize the theming of newsletters. Copy the file
    simplenews-newsletter-body.html.twig from the simplenews module directory
    to your theme directory. Both general and by-newsletter theming can
    be performed.

      simplenews-newsletter-body.html.twig (for all newsletters)
      simplenews-newsletter-body--[newsletter_id].html.twig
      simplenews-newsletter-body--[view mode].html.twig
      simplenews-newsletter-body--[newsletter_id]--[view mode].html.twig

      [newsletter_id]: Machine readable name of the newsletter category
      [view mode]: 'email-plain', 'email-html'
      Example:
        simplenews-newsletter-body--1--email-plain.html.twig

    The template files are self documented listing all available variables.
    Depending on how the mails are sent (e.g. how cron is triggered), either the
    default or the admin theme might be used, if one has been configured.
    To prevent this, Simplenews supports the mail theme setting from the
    mailsystem module (http://drupal.org/project/mailsystem). Install it, choose
    the mail theme and the newsletter templates from that theme will be used no
    matter which other themes are enabled.

    Using the fields Display settings each field of a simplenews newsletter can
    be displayed or hidden in 'plain text', 'HTML' and 'HTML text alternative'
    format. You find these settings at:
      Structure > Content types > Manage display
    Enable the view modes you want to configure and configure their display.

10. SEND MAILING LISTS

    Cron is required to send large mailing lists.
    If you have a medium or large size mailing list (i.e. more than 500
    subscribers) always use cron to send the newsletters.

    To use cron:
     * Check the 'Use cron to send newsletters' checkbox.
     * Set the 'Cron throttle' to the number of newsletters send per cron run.
       Too high values may lead to mail server overload or you may hit hosting
       restrictions. Contact your host.

    Don't use cron:
     * Uncheck the 'Use cron to send newsletters' checkbox.
       All newsletters will be sent immediately when saving the node. If not
       all emails can be sent within the available php execution time, the
       remainder will be sent by cron. Therefore ALWAYS enable cron.

    These settings are found on the Newsletter Settings page under
    'Send mail' options at:
      Administer > Configuration > Web Services > Newsletters > Settings > Send mail.

11. UNSUBSCRIBE CONFIRMATION

    By default the unsubscribe link will direct the user to a confirmation page.
    Upon confirmation the user is directed to the home page, where a message
    will be displayed. On the Simplenews subscription admin page you can
    specify an alternative destination page.
      Structure > Configuration > Web Services > Newsletters > edit newsletter category > Subscription settings

    To skip the confirmation page you can add parameters to the subscription
    URL.
      Example: [simplenews-subscriber:unsubscribe-url]/ok
    When an alternative destination page has been defined the extra parameters
    will be added to the destination URL.
      Destination: node/123
      Destination URL: node/123/ok

 12. ACCESS

    Every newsletter has an 'access' setting that determines whether subscribe
    and unsubscribe are available on newsletter forms.

    Default: Any user with 'Subscribe to newsletters' permissions can subscribe
      and unsubscribe.
    Hidden: Subscription is mandatory or handled programmatically by adding
      manual code.

    Note that mandatory subscription is restricted by law in some countries.

    Moreover, note that subscribers can be added to the spool of a newsletter
    issue through "Recipient Handlers" (missing documentation - see code in
    RecipientHandlerInterface and examples in the demo sub-module) even when
    subscribers don't have a subscription to the newsletter type corresponding
    to the issue. This can be useful for the newsletter types with access set
    to 'hidden'. Note that manual recipient handling is separate from manual
    subscription handling — these are two separate concepts!


RELATED MODULES
------------

 * Mailsystem
   Extends drupal core mailystem wirh Administrative UI and Developers API.
   http://drupal.org/project/mailsystem
 * Maillog
   Captures outgoing mails, helps users debugging simplenews.
   http://drupal.org/project/maillog


DOCUMENTATION
-------------
More help can be found on the help pages: example.com/admin/help/simplenews
and in the drupal.org handbook: http://drupal.org/node/197057
