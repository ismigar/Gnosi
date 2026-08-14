"""Tests for the rich option catalog model, roles, and seeds (option_catalogs)."""
import pytest

from backend.services import option_catalogs as oc


# --- Option normalization -------------------------------------------------

def test_normalize_option_legacy_string():
    out = oc.normalize_option("CA")
    assert out["name"] == "CA"
    assert out["color"] in oc.OPTION_COLOR_PALETTE


def test_normalize_option_rich_dict_preserves_color_and_group():
    out = oc.normalize_option({"name": "Esborrany", "color": "red", "group": "Inicial"})
    assert out == {"name": "Esborrany", "color": "red", "group": "Inicial"}


def test_normalize_option_invalid_color_replaced_by_auto():
    out = oc.normalize_option({"name": "X", "color": "fúcsia-llampant"})
    assert out["color"] in oc.OPTION_COLOR_PALETTE


def test_normalize_option_rejects_empty():
    assert oc.normalize_option("") is None
    assert oc.normalize_option({"name": "  "}) is None
    assert oc.normalize_option(None) is None


def test_normalize_options_mixed_and_dedupe():
    out = oc.normalize_options(["CA", {"name": "EN", "color": "blue"}, "CA", None])
    assert [o["name"] for o in out] == ["CA", "EN"]
    assert out[1]["color"] == "blue"


def test_auto_color_stable_and_in_palette():
    assert oc.auto_color("Esborrany") == oc.auto_color("Esborrany")
    # Accent/case-insensitive: the same name written differently doesn't change color.
    assert oc.auto_color("Traduït") == oc.auto_color("traduit")
    assert oc.auto_color("Qualsevol") in oc.OPTION_COLOR_PALETTE


# --- Reading/writing a property's catalog ---------------------------

def test_get_prop_options_nested_config_wins_over_top_level():
    prop = {
        "name": "Estat", "type": "select",
        "options": ["Vell"],
        "config": {"options": ["Fresc"]},
    }
    assert oc.option_names(oc.get_prop_options(prop)) == ["Fresc"]


def test_get_prop_options_top_level_fallback():
    prop = {"name": "Estat", "type": "select", "options": ["A", "B"]}
    assert oc.option_names(oc.get_prop_options(prop)) == ["A", "B"]


def test_get_prop_options_catalog_ref_resolves_shared():
    prop = {"name": "Tags", "type": "multi_select", "config": {"catalog_ref": "tags-generals"}}
    catalogs = {"tags-generals": ["Ètica", {"name": "Política", "color": "red"}]}
    out = oc.get_prop_options(prop, catalogs)
    assert [o["name"] for o in out] == ["Ètica", "Política"]


def test_set_prop_options_canonicalizes_location():
    prop = {"name": "Estat", "type": "select", "options": ["Vell"]}
    oc.set_prop_options(prop, [{"name": "Nou"}])
    assert "options" not in prop
    assert oc.option_names(prop["config"]["options"]) == ["Nou"]


# --- Semantic roles -----------------------------------------------------------

def _table(props, **kwargs):
    return {"id": "t1", "name": "Taula", "properties": props, **kwargs}


def test_find_role_prop_explicit_role_wins():
    t = _table([
        {"id": "f1", "name": "Qualsevol", "type": "select", "config": {"role": "status"}},
        {"id": "f2", "name": "Estat", "type": "select"},
    ])
    assert oc.find_role_prop(t, "status")["id"] == "f1"


def test_find_role_prop_name_heuristic_fallback():
    t = _table([{"id": "f1", "name": "Estado", "type": "select"}])
    assert oc.find_role_prop(t, "status")["id"] == "f1"
    assert oc.find_role_prop(t, "language") is None


def test_find_role_prop_heuristic_skips_wrong_types():
    # The text "Estat" field of "Publicacions Socials" (its own lifecycle) is not
    # a semantic status field: neither seeds nor actions. The explicit role always wins.
    t = _table([{"id": "f1", "name": "Estat", "type": "text"}])
    assert oc.find_role_prop(t, "status") is None
    assert oc.ensure_status_seed(t) is False
    t2 = _table([{"id": "f1", "name": "Qualsevol", "type": "text", "config": {"role": "status"}}])
    assert oc.find_role_prop(t2, "status")["id"] == "f1"


def test_assign_roles_by_name_and_type():
    t = _table([
        {"id": "f1", "name": "Idioma", "type": "select"},
        {"id": "f2", "name": "Estat", "type": "select"},
        {"id": "f3", "name": "Tags", "type": "multi_select"},
        {"id": "f4", "name": "Notes", "type": "text"},
    ])
    assert oc.assign_roles(t) is True
    assert t["properties"][0]["config"]["role"] == "language"
    assert t["properties"][1]["config"]["role"] == "status"
    assert t["properties"][2]["config"]["role"] == "tags"
    assert "config" not in t["properties"][3]
    # Idempotent: second pass with no changes.
    assert oc.assign_roles(t) is False


def test_assign_roles_skips_wrong_types():
    # "Tags" as select (not multi) and "Estat" multi_select: no role is assigned to them.
    t = _table([
        {"id": "f1", "name": "Tags", "type": "select"},
        {"id": "f2", "name": "Estat", "type": "multi_select"},
    ])
    assert oc.assign_roles(t) is False


# --- Seeds --------------------------------------------------------------------

def test_ensure_status_seed_base_only():
    t = _table([{"id": "f1", "name": "Estat", "type": "select", "config": {"options": ["Custom"]}}])
    assert oc.ensure_status_seed(t) is True
    names = oc.option_names(t["properties"][0]["config"]["options"])
    assert names == ["Custom", oc.STATUS_DRAFT, oc.STATUS_REVIEWED]


def test_ensure_status_seed_features_add_their_states():
    t = _table(
        [
            {"id": "f1", "name": "Estat", "type": "status"},
            {"id": "f2", "name": "XXSS", "type": "text", "system": True},
        ],
        translation_enabled=True,
        drupal_sync_enabled=True,
    )
    assert oc.ensure_status_seed(t) is True
    prop = t["properties"][0]
    names = oc.option_names(prop["config"]["options"])
    assert names == [
        oc.STATUS_DRAFT, oc.STATUS_REVIEWED, oc.STATUS_TRANSLATED,
        oc.STATUS_PUBLISHED_DRUPAL, oc.STATUS_PUBLISHED_SOCIAL,
    ]
    by_name = {o["name"]: o for o in prop["config"]["options"]}
    assert by_name[oc.STATUS_DRAFT]["group"] == "Inicial"
    assert by_name[oc.STATUS_TRANSLATED]["group"] == "En curs"
    assert by_name[oc.STATUS_PUBLISHED_DRUPAL]["group"] == "Final"
    # `status` fields receive the default groups.
    assert prop["config"]["option_groups"] == oc.DEFAULT_STATUS_GROUPS


def test_ensure_status_seed_idempotent_and_no_status_field():
    t = _table([{"id": "f1", "name": "Estat", "type": "select"}], translation_enabled=True)
    assert oc.ensure_status_seed(t) is True
    assert oc.ensure_status_seed(t) is False
    t2 = _table([{"id": "f1", "name": "Notes", "type": "text"}])
    assert oc.ensure_status_seed(t2) is False


def test_ensure_options_exist_respects_catalog_ref():
    prop = {"name": "Estat", "type": "select", "config": {"catalog_ref": "estats"}}
    assert oc.ensure_options_exist(prop, [("Esborrany", "Inicial")]) is False
    assert "options" not in prop["config"]


def test_ensure_options_exist_preserves_existing_colors():
    prop = {"name": "Estat", "type": "select",
            "config": {"options": [{"name": "Esborrany", "color": "red"}]}}
    oc.ensure_options_exist(prop, [("Esborrany", "Inicial"), ("Revisat", "En curs")])
    by_name = {o["name"]: o for o in prop["config"]["options"]}
    assert by_name["Esborrany"]["color"] == "red"
    assert "Revisat" in by_name


# --- Table normalization ----------------------------------------------------

def test_normalize_table_options_moves_and_normalizes():
    t = _table([
        {"id": "f1", "name": "Estat", "type": "select", "options": ["A", "A", ""]},
        {"id": "f2", "name": "Notes", "type": "text", "options": ["ignorat"]},
    ])
    assert oc.normalize_table_options(t) is True
    p = t["properties"][0]
    assert "options" not in p
    assert oc.option_names(p["config"]["options"]) == ["A"]
    # A non-option field is left untouched.
    assert t["properties"][1]["options"] == ["ignorat"]
    assert oc.normalize_table_options(t) is False


def test_normalize_table_options_catalog_ref_drops_local_options():
    t = _table([
        {"id": "f1", "name": "Tags", "type": "multi_select",
         "options": ["vell"], "config": {"catalog_ref": "tags-generals", "options": ["vell"]}},
    ])
    assert oc.normalize_table_options(t) is True
    cfg = t["properties"][0]["config"]
    assert cfg.get("catalog_ref") == "tags-generals"
    assert "options" not in cfg
    assert "options" not in t["properties"][0]


def test_table_has_social_column():
    assert oc.table_has_social_column(_table([{"name": "XXSS", "type": "text", "system": True}]))
    assert oc.table_has_social_column(_table([{"name": "Social", "type": "text", "config": {"system": True}}]))
    assert not oc.table_has_social_column(_table([{"name": "XXSS", "type": "text"}]))


def test_status_type_uses_one_global_catalog_and_migrates_local_options():
    registry = {
        "tables": [
            _table([
                {"id": "f1", "name": "Estat", "type": "status",
                 "config": {"options": [{"name": "En revisió", "color": "red"}]}},
            ]),
            _table([
                {"id": "f2", "name": "Lifecycle", "type": "status",
                 "config": {"options": ["Arxivat"]}},
            ], translation_enabled=True),
        ],
        "option_catalogs": {oc.STATUS_CATALOG_REF: [{"name": "Custom", "color": "blue"}]},
    }

    assert oc.ensure_global_status_catalog(registry) is True
    assert registry["option_catalogs"][oc.STATUS_CATALOG_REF][0] == {"name": "Custom", "color": "blue"}
    names = oc.option_names(registry["option_catalogs"][oc.STATUS_CATALOG_REF])
    assert names[:3] == ["Custom", "En revisió", "Arxivat"]
    assert oc.STATUS_DRAFT in names
    assert oc.STATUS_REVIEWED in names
    assert oc.STATUS_TRANSLATED in names
    for table in registry["tables"]:
        prop = table["properties"][0]
        assert prop["config"]["catalog_ref"] == oc.STATUS_CATALOG_REF
        assert "options" not in prop["config"]

    assert oc.ensure_global_status_catalog(registry) is False


def test_select_named_status_remains_table_local():
    registry = {"tables": [_table([
        {"id": "f1", "name": "Estat", "type": "select", "config": {"options": ["Local"]}},
    ])]}
    assert oc.ensure_global_status_catalog(registry) is False
    assert "option_catalogs" not in registry
    assert "catalog_ref" not in registry["tables"][0]["properties"][0]["config"]
