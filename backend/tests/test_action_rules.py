"""Tests for the action_rules engine (requires/effects/on_stale)."""
import pytest

from backend.services import action_rules as ar
from backend.services import option_catalogs as oc


def _table(**kwargs):
    base = {
        "id": "t1",
        "name": "Articles",
        "properties": [
            {"id": "fld_estat", "name": "Estat", "type": "status",
             "config": {"role": "status", "options": [
                 {"name": "Esborrany", "color": "gray", "group": "Inicial"},
                 {"name": "Revisat", "color": "green", "group": "En curs"},
             ]}},
            {"id": "fld_idioma", "name": "Idioma", "type": "select",
             "config": {"role": "language"}},
        ],
        "translation_enabled": True,
    }
    base.update(kwargs)
    return base


# --- get_action_rules / ensure_action_rules -----------------------------------

def test_get_action_rules_falls_back_to_default_when_feature_enabled():
    t = _table()
    rules = ar.get_action_rules(t, ar.ACTION_TRANSLATE)
    assert rules["requires"][0]["not_in"] == [oc.STATUS_DRAFT]


def test_get_action_rules_registry_block_wins():
    t = _table(action_rules={ar.ACTION_TRANSLATE: {"requires": []}})
    assert ar.get_action_rules(t, ar.ACTION_TRANSLATE) == {"requires": []}


def test_get_action_rules_none_when_feature_disabled():
    t = _table(translation_enabled=False)
    assert ar.get_action_rules(t, ar.ACTION_TRANSLATE) is None
    assert ar.get_action_rules(t, ar.ACTION_SYNC_DRUPAL) is None


def test_ensure_action_rules_seeds_only_active_features():
    t = _table(drupal_sync_enabled=True)
    assert ar.ensure_action_rules(t) is True
    assert set(t["action_rules"].keys()) == {ar.ACTION_TRANSLATE, ar.ACTION_SYNC_DRUPAL}
    # Idempotent and never overwrites a manually edited block.
    t["action_rules"][ar.ACTION_TRANSLATE]["requires"] = []
    assert ar.ensure_action_rules(t) is False
    assert t["action_rules"][ar.ACTION_TRANSLATE]["requires"] == []


# --- check_requires -------------------------------------------------------------

def test_check_requires_blocks_draft_with_reason():
    t = _table()
    ok, reason = ar.check_requires(t, ar.ACTION_TRANSLATE, {"Estat": "Esborrany"})
    assert ok is False
    assert "esborrany" in reason.lower()


def test_check_requires_passes_non_draft_and_reads_by_field_id():
    t = _table()
    assert ar.check_requires(t, ar.ACTION_TRANSLATE, {"Estat": "Revisat"}) == (True, None)
    ok, _ = ar.check_requires(t, ar.ACTION_TRANSLATE, {"fld_estat": "Esborrany"})
    assert ok is False


def test_check_requires_passes_when_no_value_or_no_field():
    t = _table()
    assert ar.check_requires(t, ar.ACTION_TRANSLATE, {})[0] is True
    t2 = _table(properties=[{"id": "f9", "name": "Notes", "type": "text"}])
    assert ar.check_requires(t2, ar.ACTION_TRANSLATE, {"Estat": "Esborrany"})[0] is True


def test_check_requires_in_group():
    t = _table(action_rules={ar.ACTION_PUBLISH_SOCIAL: {"requires": [
        {"role": "status", "in_group": "En curs", "reason": "Només es publica el que està en curs"},
    ]}})
    ok, reason = ar.check_requires(t, ar.ACTION_PUBLISH_SOCIAL, {"Estat": "Esborrany"})
    assert ok is False and reason.startswith("Només")
    assert ar.check_requires(t, ar.ACTION_PUBLISH_SOCIAL, {"Estat": "Revisat"})[0] is True


def test_check_requires_multiselect_value_any_match_blocks():
    t = _table()
    t["properties"][0]["type"] = "multi_select"
    ok, _ = ar.check_requires(t, ar.ACTION_TRANSLATE, {"Estat": ["Revisat", "Esborrany"]})
    assert ok is False


# --- effects ----------------------------------------------------------------------

def test_status_effect_source_and_created():
    t = _table()
    prop, value, changed = ar.status_effect(t, ar.ACTION_TRANSLATE, "source")
    assert (prop["id"], value) == ("fld_estat", oc.STATUS_TRANSLATED)
    # «Traduït» wasn't in the catalog → it was added (the rule never fails).
    assert changed is True
    names = oc.option_names(t["properties"][0]["config"]["options"])
    assert oc.STATUS_TRANSLATED in names

    prop, value, changed = ar.status_effect(t, ar.ACTION_TRANSLATE, "created")
    assert (prop["id"], value) == ("fld_estat", oc.STATUS_DRAFT)
    assert changed is False  # was already there


def test_status_effect_none_when_no_rules_or_target():
    t = _table(translation_enabled=False)
    assert ar.status_effect(t, ar.ACTION_TRANSLATE, "source") == (None, None, False)
    t2 = _table(drupal_sync_enabled=True)
    assert ar.status_effect(t2, ar.ACTION_SYNC_DRUPAL, "created") == (None, None, False)


def test_effect_write_key_prefers_existing_metadata_key():
    prop = {"id": "fld_estat", "name": "Estat", "aliases": ["Status"]}
    assert ar.effect_write_key({"Estat": "Revisat"}, prop) == "Estat"
    assert ar.effect_write_key({"Status": "Revisat"}, prop) == "Status"
    assert ar.effect_write_key({}, prop) == "fld_estat"


def test_on_stale_effect_returns_draft():
    t = _table()
    prop, value, _ = ar.on_stale_effect(t)
    assert (prop["id"], value) == ("fld_estat", oc.STATUS_DRAFT)


def test_on_stale_effect_disabled_by_registry_block():
    t = _table(action_rules={ar.ACTION_TRANSLATE: {"on_stale": []}})
    assert ar.on_stale_effect(t) == (None, None, False)
