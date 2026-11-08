"""Reviewed root routing for a retained Drupal-to-Webs cutover.

This module generates artifacts; it never connects to a server or changes routing.
The operator must bind activation to the verified release and backup receipts.
"""
import re


def root_htaccess(namespace: str, withdrawn: list[str] | None = None) -> str:
    if not re.fullmatch(r"/_gnosi-live/webs/[a-f0-9]{32}/current", namespace):
        raise ValueError("Invalid production namespace")
    gone = []
    for path in withdrawn or []:
        if not path.startswith("/") or any(c in path for c in "\r\n\\?#") or any(part in {".", ".."} for part in path.split("/")):
            raise ValueError("Invalid withdrawn public route")
        gone.append("RewriteRule ^" + re.escape(path.lstrip("/")) + "/?$ - [G,END]")
    return "\n".join([
        "# Gnosi production routing; Drupal retained for verified rollback.",
        "Options -Indexes -MultiViews +FollowSymLinks",
        "DirectoryIndex index.html",
        'AddDefaultCharset UTF-8',
        '<FilesMatch "(^\\.|\\.(?:sql|sqlite|yml|yaml|ini|log|sh|bak|lock)$)">',
        'Require all denied',
        '</FilesMatch>',
        '<If "unescape(%{THE_REQUEST}) =~ m#\\s/+_gnosi-live(?:/|\\s|\\?)#">',
        'Require all denied',
        '</If>',
        'RewriteEngine On',
        # Preserve the staging subtree and ACME challenge handling exactly as owned.
        'RewriteRule ^_gnosi-proves(?:/|$) - [L]',
        'RewriteRule ^\\.well-known/acme-challenge(?:/|$) - [L]',
        # Historical public attachments remain available; executable files do not.
        'RewriteRule ^sites/default/files/.*\\.(?:php[0-9]?|phtml|phar|cgi|pl|py|sh)(?:/|$) - [F,END,NC]',
        'RewriteRule ^sites/default/files/ - [L]',
        # Direct requests cannot bypass root routing into a release namespace.
        'RewriteCond %{ENV:REDIRECT_GNOSI_PUBLIC} !^1$',
        'RewriteRule ^_gnosi-live(?:/|$) - [F,END]',
        'RewriteRule ^_gnosi-live(?:/|$) - [L]',
        *gone,
        'RewriteRule ^ - [E=GNOSI_PUBLIC:1]',
        'RewriteRule ^(.*)$ ' + namespace.lstrip('/') + '/$1 [L]',
        '',
    ])
