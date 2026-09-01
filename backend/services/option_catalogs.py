"""Compatibility facade for table option catalogs and semantic roles.

Canonical implementations live in ``backend.domains.vault.tables.catalogs``.
The historical service module remains an import-stable, state-free facade.
"""

import re as re
import unicodedata as unicodedata
from typing import Any as Any
from typing import Dict as Dict
from typing import List as List
from typing import Optional as Optional
from typing import Tuple as Tuple

from backend.domains.vault.tables.catalogs.core import (
    OPTION_COLOR_PALETTE as OPTION_COLOR_PALETTE,
)
from backend.domains.vault.tables.catalogs.core import OPTION_TYPES as OPTION_TYPES
from backend.domains.vault.tables.catalogs.core import _norm_name as _norm_name
from backend.domains.vault.tables.catalogs.core import _strip_accents as _strip_accents
from backend.domains.vault.tables.catalogs.core import auto_color as auto_color
from backend.domains.vault.tables.catalogs.core import get_prop_config as get_prop_config
from backend.domains.vault.tables.catalogs.core import get_prop_options as get_prop_options
from backend.domains.vault.tables.catalogs.core import (
    is_global_status_prop as is_global_status_prop,
)
from backend.domains.vault.tables.catalogs.core import normalize_option as normalize_option
from backend.domains.vault.tables.catalogs.core import normalize_options as normalize_options
from backend.domains.vault.tables.catalogs.core import option_names as option_names
from backend.domains.vault.tables.catalogs.core import set_prop_options as set_prop_options
from backend.domains.vault.tables.catalogs.global_status import (
    ensure_global_status_catalog as ensure_global_status_catalog,
)
from backend.domains.vault.tables.catalogs.roles import (
    ROLE_ALLOWED_TYPES as _ROLE_ALLOWED_TYPES,
)
from backend.domains.vault.tables.catalogs.roles import (
    ROLE_FIELD_NAMES as _ROLE_FIELD_NAMES,
)
from backend.domains.vault.tables.catalogs.roles import ROLE_LANGUAGE as ROLE_LANGUAGE
from backend.domains.vault.tables.catalogs.roles import ROLE_STATUS as ROLE_STATUS
from backend.domains.vault.tables.catalogs.roles import ROLE_TAGS as ROLE_TAGS
from backend.domains.vault.tables.catalogs.roles import SOCIAL_COLUMN_RE as _SOCIAL_COLUMN_RE
from backend.domains.vault.tables.catalogs.roles import assign_roles as assign_roles
from backend.domains.vault.tables.catalogs.roles import find_role_prop as find_role_prop
from backend.domains.vault.tables.catalogs.roles import prop_role as prop_role
from backend.domains.vault.tables.catalogs.roles import (
    table_has_social_column as table_has_social_column,
)
from backend.domains.vault.tables.catalogs.seeds import (
    BASE_STATUS_SEED as BASE_STATUS_SEED,
)
from backend.domains.vault.tables.catalogs.seeds import (
    DEFAULT_STATUS_GROUPS as DEFAULT_STATUS_GROUPS,
)
from backend.domains.vault.tables.catalogs.seeds import (
    STATUS_CATALOG_REF as STATUS_CATALOG_REF,
)
from backend.domains.vault.tables.catalogs.seeds import STATUS_DRAFT as STATUS_DRAFT
from backend.domains.vault.tables.catalogs.seeds import (
    STATUS_PUBLISHED_DRUPAL as STATUS_PUBLISHED_DRUPAL,
)
from backend.domains.vault.tables.catalogs.seeds import (
    STATUS_PUBLISHED_SOCIAL as STATUS_PUBLISHED_SOCIAL,
)
from backend.domains.vault.tables.catalogs.seeds import STATUS_REVIEWED as STATUS_REVIEWED
from backend.domains.vault.tables.catalogs.seeds import (
    STATUS_TRANSLATED as STATUS_TRANSLATED,
)
from backend.domains.vault.tables.catalogs.seeds import (
    ensure_options_exist as ensure_options_exist,
)
from backend.domains.vault.tables.catalogs.seeds import ensure_status_seed as ensure_status_seed
from backend.domains.vault.tables.catalogs.seeds import ensure_table_seeds as ensure_table_seeds
from backend.domains.vault.tables.catalogs.seeds import (
    normalize_table_options as normalize_table_options,
)
