"""Compatibility facade for the canonical Drupal connector."""

from backend.domains.mail.connectors.drupal import (
    _TIMEOUT as _TIMEOUT,
)
from backend.domains.mail.connectors.drupal import (
    JSONAPI as JSONAPI,
)
from backend.domains.mail.connectors.drupal import (
    DrupalNotFound as DrupalNotFound,
)
from backend.domains.mail.connectors.drupal import (
    DrupalSyncError as DrupalSyncError,
)
from backend.domains.mail.connectors.drupal import (
    _auth as _auth,
)
from backend.domains.mail.connectors.drupal import (
    _base_url as _base_url,
)
from backend.domains.mail.connectors.drupal import (
    _client as _client,
)
from backend.domains.mail.connectors.drupal import (
    _label_from_machine as _label_from_machine,
)
from backend.domains.mail.connectors.drupal import (
    _node_url as _node_url,
)
from backend.domains.mail.connectors.drupal import (
    _norm_title as _norm_title,
)
from backend.domains.mail.connectors.drupal import (
    _password as _password,
)
from backend.domains.mail.connectors.drupal import (
    _raise_for as _raise_for,
)
from backend.domains.mail.connectors.drupal import (
    add_translation as add_translation,
)
from backend.domains.mail.connectors.drupal import (
    base_url as base_url,
)
from backend.domains.mail.connectors.drupal import (
    create_node as create_node,
)
from backend.domains.mail.connectors.drupal import (
    find_existing_file as find_existing_file,
)
from backend.domains.mail.connectors.drupal import (
    find_nodes_by_title as find_nodes_by_title,
)
from backend.domains.mail.connectors.drupal import (
    list_content_types as list_content_types,
)
from backend.domains.mail.connectors.drupal import (
    list_fields as list_fields,
)
from backend.domains.mail.connectors.drupal import (
    markdown_to_full_html as markdown_to_full_html,
)
from backend.domains.mail.connectors.drupal import (
    resolve_or_create_term as resolve_or_create_term,
)
from backend.domains.mail.connectors.drupal import (
    update_node as update_node,
)
from backend.domains.mail.connectors.drupal import (
    upload_image as upload_image,
)
