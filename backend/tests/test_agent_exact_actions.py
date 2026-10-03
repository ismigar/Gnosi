"""Exact assignments cannot invent rows, fields or option values."""

import json

import pytest

from backend.domains.agent.exact_actions import exact_assignment_call


def inventory(**changes):
    return json.dumps({
        "property_filters": {"recurs": "El papa de mis sueños"},
        "matching_count": 3, "has_more": False,
        "records": [{"id": f"note-{i}", "record_type": {"id": "brain"}} for i in range(3)],
        "field_definitions": {"brain": [
            {"id": "estat", "name": "estat", "type": "status", "options": ["Pendent", "En revisió"]},
            {"id": "score", "name": "score", "type": "number"},
            {"id": "done", "name": "done", "type": "checkbox"},
        ]}, **changes,
    })


@pytest.mark.parametrize("message", [
    'Busca todas las entradas de la tabla Cervell Digital donde recurs es "El papa de mis sueños" y asigna "En revisió" al campo estat.',
    'Find all entries in the Cervell Digital table where recurs is "El papa de mis sueños" and set estat to "En revisió".',
    'Cherche toutes les entrées de la table Cervell Digital où recurs est "El papa de mis sueños" et définis estat sur "En revisió".',

    'Necessito que busquis totes les entrades i assignis "En revisió" al camp estat.',
    'Busca las filas y asigna "En revisió" al campo estat.',
    'Find the rows and set the estat field to "En revisió".',
    'Trouve les lignes et attribue «En revisió» au champ estat.',
])
def test_prepares_only_the_three_evidenced_rows_and_requested_field(message):
    call = exact_assignment_call(message, inventory())
    assert call["name"] == "bulk_update_rows"
    assert call["args"]["updates"] == [
        {"id": f"note-{i}", "properties": {"estat": "En revisió"}} for i in range(3)
    ]


@pytest.mark.parametrize("changes", [{"has_more": True}, {"matching_count": 121}])
def test_partial_inventory_cannot_produce_a_partial_bulk_change(changes):
    with pytest.raises(ValueError, match="incomplete"):
        exact_assignment_call('Assigna "En revisió" al camp estat.', inventory(**changes))


@pytest.mark.parametrize("message", [
    'Assigna "Inventat" al camp estat.',
    'Assigna "En revisió" al camp inexistent.',
    'Set the score field to "NaN".',
])
def test_invalid_fields_values_and_nonfinite_numbers_are_rejected(message):
    with pytest.raises(ValueError):
        exact_assignment_call(message, inventory())


@pytest.mark.parametrize("message,properties", [
    ('Set the score field to "0".', {"score": 0}),
    ('Set the done field to "false".', {"done": False}),
])
def test_numeric_zero_and_false_retain_their_types(message, properties):
    call = exact_assignment_call(message, inventory())
    assert all(update["properties"] == properties for update in call["args"]["updates"])


def test_unfiltered_or_non_assignment_text_cannot_use_the_exact_write_path():
    assert exact_assignment_call('Assigna "En revisió" al camp estat.', inventory(property_filters={})) is None
    assert exact_assignment_call('Explica com canviar el camp estat.', inventory()) is None


@pytest.mark.parametrize("error", ["inventory_changed_restart_pagination", "inventory_unavailable"])
def test_failed_inventory_cannot_fall_back_to_model_generated_row_updates(error):
    with pytest.raises(ValueError, match="inventory_failed"):
        exact_assignment_call('Assigna "En revisió" al camp estat.', json.dumps({"error": error}))
