"""Operation mismatches and malformed chat deliverables cannot report success."""
import json

import pytest
from jsonschema import ValidationError
from langchain_core.messages import AIMessage

from backend.services.agent_team_contracts import output_schema, validate_plan_contract, required_operation, explicit_output_keys, explicit_output_schema, output_contract_requested, operation_for_output_keys, initial_greeting
from backend.services.agent_team_models import TeamPlan, TeamTask, TeamOutputContract, TeamOutputField
from backend.tests.test_agent_team import optional_runtime, team_runtime  # noqa: F401
from backend.tests.test_principal_agent_routing import run_chat

BOOLEAN = {"type": "object", "properties": {"value": {"type": "boolean"}},
           "required": ["value"], "additionalProperties": False}


def test_plugin_operation_prefix_does_not_borrow_an_application_skill():
    assert required_operation("knowledge.process-source.phase", ["plugin.llm-wiki.process-source"]) == ""
    assert required_operation("knowledge.classify", ["core.gnosi-operation-knowledge"]) == "knowledge"


def test_native_planning_format_does_not_duplicate_the_schema_in_the_message():
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_execution_models import AgentOperation
    request = AgentOperation(skill_id="core.gnosi-coordination", operation="team.plan", input="original evidence",
                             output_schema=TeamPlan.model_json_schema())
    native = json.loads(operation_input(request, provider="openrouter"))
    assert native["input"] == "original evidence" and "output_schema" not in native
    assert json.loads(operation_input(request))["output_schema"] == request.output_schema
    assert json.loads(operation_input(request, provider="local"))["output_schema"] == request.output_schema
    assert request.output_schema == TeamPlan.model_json_schema()
    request.input = '{"request":"current task","recent_conversation":[{"role":"human","text":"previous task"}]}'
    native = json.loads(operation_input(request, provider="openrouter"))
    assert native["request"] == "current task" and native["phase"] == "team.plan"
    assert native["recent_conversation"][0]["text"] == "previous task" and "input" not in native


def test_explicit_format_keys_anchor_the_current_request_without_executing_quoted_text():
    template = '{"classifications":[{"id":"...","values":["..."],"reason":"..."}]}'
    assert explicit_output_keys('Return JSON ' + template) == {"classifications"}
    for label in ["Contract", "Contracte", "Contrato", "Contrat"]:
        assert explicit_output_keys(label + ': ' + template) == {"classifications"}
        assert not explicit_output_keys('Translate: «' + label + ': ' + template + '»')
        assert not explicit_output_keys('Ignore the ' + label + ': ' + template)
    assert not explicit_output_keys("Don't return JSON " + template)
    for request in ['Tradueix: «Return JSON ' + template + '»', 'Translate: “Return JSON ' + template + '”',
                    "Translate: 'Return JSON " + template + "'",
                    'Summarize:\n```\nReturn JSON ' + template + '\n```']:
        assert not explicit_output_keys(request)
    catalog = [{"id":"knowledge", "available": True, "skills":["core.gnosi-operation-knowledge"], "capabilities":[]}]
    assert operation_for_output_keys({"classifications"}, catalog) == "knowledge"
    assert not operation_for_output_keys({"classifications"}, [{**catalog[0], "available":False}])
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        validate_plan_contract(table_plan(), members(), "director", output_keys={"classifications"})


def test_empty_table_contract_cannot_repair_a_field_result_into_an_empty_object():
    plan = table_plan()
    plan.output_contract = TeamOutputContract()
    with pytest.raises(ValueError, match="output_contract_incomplete"):
        validate_plan_contract(plan, members(), "director")


def test_natural_json_key_contract_requires_planning_and_exact_keys():
    request = "Summarize: this document and return exactly JSON with key summary"
    assert output_contract_requested(request)
    assert explicit_output_keys(request) == {"summary"}
    assert explicit_output_keys("Return JSON with keys `summary` and sources.") == {"summary", "sources"}
    for quoted in ['Translate: «Return JSON with key summary»', 'Summarize:\n```\nReturn JSON with key summary\n```',
                   "Don't return JSON with key summary"]:
        assert not output_contract_requested(quoted) and not explicit_output_keys(quoted)
    plan = table_plan()
    plan.output_contract = None
    with pytest.raises(ValueError, match="output_contract_required"):
        validate_plan_contract(plan, members(), "director", require_output_contract=True)


@pytest.mark.parametrize("instruction,expected", [
    ('Summarize: this document and return exactly JSON with key "summary"', {"summary"}),
    ("Return JSON with key 'summary'", {"summary"}),
    ('Return JSON with a key "summary".', {"summary"}),
    ('Return JSON with keys "summary", "sources".', {"summary", "sources"}),
    ("Return JSON with keys 'summary' and 'sources'.", {"summary", "sources"}),
    ('Return JSON with keys "summary", `sources`, and author.', {"summary", "sources", "author"}),
    ('Return JSON with key "summary, sources".', {"summary, sources"}),
    ('Return JSON with key "résumé.final".', {"résumé.final"}),
    ('Return JSON with key "quote\\\"d".', {'quote"d'}),
    ('Resumeix: el document i retorna exactament JSON amb les claus "resum" i "fonts".', {"resum", "fonts"}),
    ("Resume: el documento y devuelve exactamente JSON con las claves 'resumen', 'fuentes'.", {"resumen", "fuentes"}),
    ('Résume: ce document et retourne exactement JSON avec les clés “résumé” et “sources”.', {"résumé", "sources"}),
    ('Retorna JSON amb la clau «resum».', {"resum"}),
    ('Retorna JSON amb la clau ‘resum’.', {"resum"}),
    ('Return JSON with key "summary". Keep it short.', {"summary"}),
    ("Return JSON with keys 'summary' and 'sources'; both as strings.", {"summary", "sources"}),
    ('Return JSON with key "summary".\nDo not add other keys.', {"summary"}),
    ('Return JSON with key "summary" only.', {"summary"}),
    ('Return JSON with key "summary" and nothing else.', {"summary"}),
    ('Return JSON with keys "summary", "sources", without other keys.', {"summary", "sources"}),
    ('Retorna JSON amb la clau «resum» i res més.', {"resum"}),
    ('Devuelve JSON con la clave «resumen» y nada más.', {"resumen"}),
    ("Retourne JSON avec les clés ‘résumé’ et ‘sources’, sans autres clés.", {"résumé", "sources"}),
    ('Return only valid JSON with key "summary".', {"summary"}),
    ('Return a JSON object with key "summary".', {"summary"}),
    ('Return JSON with key "summary" and no other keys.', {"summary"}),
    ('Return JSON with key "summary" and do not add anything else.', {"summary"}),
    ('Return JSON with fields "summary" and "sources".', {"summary", "sources"}),
    ('Retorna un objecte JSON amb el camp "resum".', {"resum"}),
    ('Retorna un JSON objecte amb el camp "resum".', {"resum"}),
    ('Devuelve un JSON objeto con el campo "resumen".', {"resumen"}),
    ('Retourne un JSON objet avec le champ "résumé".', {"résumé"}),
    ('Devuelve un objeto JSON con la propiedad "resumen".', {"resumen"}),
    ('Retourne un objet JSON avec la propriété "résumé".', {"résumé"}),
    ('Return JSON with the following keys: "summary" and "sources".', {"summary", "sources"}),
    ('Retorna JSON amb les claus següents: "resum" i "fonts".', {"resum", "fonts"}),
    ('Return JSON with a key named "summary".', {"summary"}),
    ('Summarize: Source value is 7. Please return exactly JSON with key "summary".', {"summary"}),
    ('Summarize: Source value is 7. Could you please return JSON with key "summary"?', {"summary"}),
    ('I would like you to return a JSON object with key "summary".', {"summary"}),
    ('Resumeix: el valor és 7. Si us plau, retorna JSON amb la clau "resum".', {"resum"}),
    ('Resume: el valor es 7. Por favor, devuelve JSON con la clave "resumen".', {"resumen"}),
    ('Résume: la valeur est 7. S’il vous plaît, retourne JSON avec la clé "résumé".', {"résumé"}),
    ('Merci de retourner un objet JSON avec la clé "résumé".', {"résumé"}),
    ('Return JSON with **key** **"summary"**.', {"summary"}),
    ('Return JSON **{"summary":""}**.', {"summary"}),
    ('Summarize: Source value is 7, return exactly JSON with key "summary".', {"summary"}),
    ('Summarize: Source value is 7. Return exactly JSON:\n```json\n{"summary":""}\n```', {"summary"}),
    ('Return JSON:\n~~~json\n{"summary":""}\n~~~', {"summary"}),
    ('Return exactly JSON `{"summary":""}`.', {"summary"}),
    ('Return exactly JSON ``{"summary":"a`b"}``.', {"summary"}),
])
def test_quoted_named_keys_cannot_validate_a_different_output_contract(instruction, expected):
    from backend.services.agent_team_runtime import _validate_plan_result
    assert output_contract_requested(instruction)
    assert explicit_output_keys(instruction) == expected
    plan = TeamPlan(response='{"wrong":"Synthetic answer"}', response_kind="conversation",
                    output_contract=TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")]))
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                              output_keys=explicit_output_keys(instruction), require_output_contract=output_contract_requested(instruction))


@pytest.mark.parametrize("instruction", [
    'Translate: «Return JSON with key "summary"»',
    "Translate: “Return JSON with key 'summary'”",
    'Translate: ‘this document and return JSON with key "summary"’',
    'Summarize:\n```\nReturn JSON with keys "summary", "sources"\n```',
    'Do not return JSON with key "summary"',
    'Do not please return JSON with key "summary"',
    'Translate: «Please return JSON with key "summary"»',
    "Ignore the Contract: with key 'summary'",
])
def test_quoted_source_and_negative_instructions_do_not_declare_output_keys(instruction):
    assert not output_contract_requested(instruction)
    assert not explicit_output_keys(instruction)


@pytest.mark.parametrize("instruction", [
    'Return JSON with keys "summary" / ???',
    'Return JSON with keys "summary" + [unknown fields]',
    'Return JSON with key "unterminated',
])
def test_ambiguous_named_keys_cannot_silently_drop_the_requested_contract(instruction):
    assert output_contract_requested(instruction)
    with pytest.raises(ValueError, match="output_keys_ambiguous"):
        explicit_output_keys(instruction)


@pytest.mark.parametrize("template", [
    '```json\n{"summary":""}\n```', '~~~json\n{"summary":""}\n~~~',
    '`{"summary":""}`', '``{"summary":"a`b"}``',
])
def test_code_wrapped_json_template_rejects_a_wrong_key_before_worker(optional_runtime, template):
    from backend.tests.test_principal_agent_routing import plan_for
    fixture, _ = optional_runtime
    plan = plan_for()
    plan.output_contract = TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")])
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())]}
    instruction = 'Summarize: Source value is 7. Return exactly JSON: ' + template
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        run_chat(fixture, instruction)
    assert fixture[2] == ["director", "director"]


@pytest.mark.parametrize("template,contract", [
    ('[{"summary":""}]', TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")])),
    ('{"result":{"summary":""}}', TeamOutputContract(fields=[TeamOutputField(path=["result", "wrong"], type="string")])),
    ('{"summary":""}', TeamOutputContract(fields=[TeamOutputField(path=["summary"], type="boolean")])),
    ('[{"summary":""}]', TeamOutputContract(type="array", fields=[TeamOutputField(path=["*", "wrong"], type="string")])),
    ('{"values":[0]}', TeamOutputContract(fields=[TeamOutputField(path=["values"], type="array")])),
    ('{"result":{"summary":""}}', TeamOutputContract(fields=[TeamOutputField(path=["result", "summary"], type="string", required=False)])),
    ('{"empty":{}}', TeamOutputContract(fields=[TeamOutputField(path=["empty", "wrong"], type="string")])),
    ('false', TeamOutputContract(type="string")),
    ('0', TeamOutputContract(type="number")),
    ('null', TeamOutputContract(type="object")),
])
def test_explicit_template_shape_and_types_reject_an_incompatible_plan_before_execution(optional_runtime, template, contract):
    from backend.tests.test_principal_agent_routing import plan_for
    from backend.services import agent_team_store as artifacts
    fixture, _ = optional_runtime
    plan = plan_for()
    plan.output_contract = contract
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())]}
    with pytest.raises((ValueError, ValidationError), match="output_contract_mismatch|was expected"):
        run_chat(fixture, 'Summarize: Source value is 7. Return exactly JSON:\n```json\n' + template + '\n```')
    assert fixture[2] == ["director", "director"]
    assert artifacts.list_artifacts(fixture[0], "task") == []


@pytest.mark.parametrize("template,contract,result", [
    ('[{"summary":""}]', TeamOutputContract(type="array", fields=[TeamOutputField(path=["*", "summary"], type="string")]), '[{"summary":"7"}]'),
    ('{"result":{"summary":""}}', TeamOutputContract(fields=[TeamOutputField(path=["result", "summary"], type="string")]), '{"result":{"summary":"7"}}'),
    ('{"values":[0]}', TeamOutputContract(fields=[TeamOutputField(path=["values"], type="array"), TeamOutputField(path=["values", "*"], type="integer")]), '{"values":[7]}'),
    ('{"values":[""]}', TeamOutputContract(fields=[TeamOutputField(path=["values"], type="array", choices=["seven"])]), '{"values":["seven"]}'),
    ('{"values":["",false]}', TeamOutputContract(fields=[TeamOutputField(path=["values"], type="array", choices=["seven", True])]), '{"values":["seven",true]}'),
    ('{"empty":{},"values":[]}', TeamOutputContract(fields=[TeamOutputField(path=["empty"], type="object"), TeamOutputField(path=["values"], type="array")]), '{"empty":{},"values":[7]}'),
    ('false', TeamOutputContract(type="boolean"), 'true'),
    ('0.0', TeamOutputContract(type="integer"), '7'),
    ('null', TeamOutputContract(type="null"), 'null'),
    ('""', TeamOutputContract(type="string"), '"seven"'),
])
def test_explicit_template_shape_accepts_a_typed_deliverable_without_fixing_example_values(optional_runtime, template, contract, result):
    from backend.tests.test_principal_agent_routing import plan_for
    fixture, _ = optional_runtime
    plan = plan_for()
    plan.output_contract = contract
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content=result)]}
    messages, _ = run_chat(fixture, 'Summarize: Source value is 7. Return exactly JSON:\n```json\n' + template + '\n```')
    assert fixture[2] == ["director", "worker"]
    assert json.loads(messages[-1].content) == json.loads(result)
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "validated"


def test_direct_response_cannot_substitute_nested_keys_or_types_in_the_requested_template():
    from backend.services.agent_team_runtime import _validate_plan_result
    requested = explicit_output_schema('Return exactly JSON {"result":{"summary":""}}')
    plan = TeamPlan(response='{"result":{"summary":false}}', output_contract=TeamOutputContract(
        fields=[TeamOutputField(path=["result", "summary"], type="boolean")]))
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                              requested_output_schema=requested, require_output_contract=True)
    plan.output_contract.fields[0].type = "string"
    from jsonschema import ValidationError
    with pytest.raises(ValidationError):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                              requested_output_schema=requested, require_output_contract=True)


@pytest.mark.parametrize("template", ['{"summary":}', '[{"summary":""}', '{"value":NaN}', '{"value":Infinity}'])
def test_malformed_literal_templates_cannot_silently_lose_the_output_shape(template):
    with pytest.raises(ValueError, match="output_template_ambiguous"):
        explicit_output_schema('Return exactly JSON ' + template)


@pytest.mark.parametrize("instruction", [
    'Return JSON: ```json\n{"summary":""}', 'Return JSON: `{"summary":""}',
])
def test_unclosed_output_template_cannot_be_reported_as_validated(instruction):
    with pytest.raises(ValueError, match="output_template_ambiguous"):
        explicit_output_keys(instruction)


@pytest.mark.parametrize("prefix,suffix", [
    ('- ', ''), ('+ ', ''), ('* ', ''), ('1. ', ''), ('2) ', ''),
    ('- [ ] ', ''), ('- [x] ', ''), ('### ', ''),
    ('**', '**'), ('__', '__'), ('*', '*'), ('~~', '~~'), ('- **', '**'),
])
@pytest.mark.parametrize("polite", [False, True])
def test_markdown_request_layout_preserves_the_exact_json_keys(optional_runtime, prefix, suffix, polite):
    from backend.tests.test_principal_agent_routing import plan_for
    fixture, _ = optional_runtime
    instruction = 'Summarize: Source value is 7.\n' + prefix + ('Please ' if polite else '') + 'return exactly JSON with key "summary"' + suffix
    assert output_contract_requested(instruction)
    assert explicit_output_keys(instruction) == {"summary"}
    plan = plan_for()
    plan.output_contract = TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")])
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content='{"wrong":"Synthetic source value is 7."}')]}
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        run_chat(fixture, instruction)
    assert fixture[2] == ["director", "director"]


@pytest.mark.parametrize("instruction", [
    'Summarize:\n> Please return JSON with key "summary"',
    'Summarize:\n- `Please return JSON with key "summary"`',
    'Summarize:\n```\n- Please return JSON with key "summary"\n```',
    'Summarize:\n~~~\n- Please return JSON with key "summary"\n~~~',
])
def test_markdown_quoted_and_code_sources_do_not_supply_json_instructions(instruction):
    assert not output_contract_requested(instruction)
    assert explicit_output_keys(instruction) is None


@pytest.mark.parametrize("leadin", ["", "Please ", "Could you please ", "I would like you to ", "Si us plau, ", "Por favor, ", "S’il vous plaît, "])
@pytest.mark.parametrize("key_syntax", ['"summary"', "'summary'"])
def test_routine_chat_cannot_return_a_validated_different_quoted_key(optional_runtime, key_syntax, leadin):
    from backend.tests.test_principal_agent_routing import plan_for
    fixture, _ = optional_runtime
    plan = plan_for()
    plan.output_contract = TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")])
    fixture[3]["_phase_responses"] = {"team.plan": [AIMessage(content=plan.model_dump_json())]}
    fixture[3]["_responses"] = {"worker": [AIMessage(content='{"wrong":"Synthetic source value is 7."}')]}
    request = "Summarize: Source value is 7. " + leadin + "return exactly JSON with key " + key_syntax
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        run_chat(fixture, request)
    assert fixture[2] == ["director", "director"]
    from backend.services import agent_team_store as artifacts
    assert artifacts.list_artifacts(fixture[0], "task") == []


def test_explicit_empty_object_is_distinct_from_an_unspecified_key_set():
    from backend.services.agent_team_runtime import _validate_plan_result
    assert explicit_output_keys("Return exactly JSON {}") == set()
    assert explicit_output_keys("Summarize this sentence") is None
    plan = TeamPlan(response='{"wrong":"Synthetic answer"}', response_kind="conversation",
                    output_contract=TeamOutputContract(fields=[TeamOutputField(path=["wrong"], type="string")]))
    with pytest.raises(ValueError, match="output_contract_mismatch"):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                              output_keys=explicit_output_keys("Return exactly JSON {}"), require_output_contract=True)
    plan.output_contract = TeamOutputContract()
    plan.response = '{}'
    assert _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                                 output_keys=set(), require_output_contract=True)


def test_direct_response_cannot_bypass_its_native_output_contract():
    from backend.services.agent_team_runtime import _validate_plan_result
    from jsonschema import ValidationError
    plan = TeamPlan(response='{"value":"wrong type"}', output_contract=TeamOutputContract(fields=[TeamOutputField(path=["value"], type="boolean")]))
    with pytest.raises(ValidationError):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director")
    plan.response = '{"value":false}'
    assert _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director")


@pytest.mark.parametrize("contract", [None,
    TeamOutputContract(fields=[TeamOutputField(path=["summary"], type="string", required=False)]),
    TeamOutputContract(fields=[TeamOutputField(path=["summary"], type="string")], allow_extra_keys=True),
])
def test_direct_response_without_a_specialist_preserves_exact_requested_keys(contract):
    from backend.services.agent_team_runtime import _validate_plan_result
    plan = TeamPlan(response='{}', output_contract=contract)
    with pytest.raises(ValueError, match="output_contract"):
        _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                              output_keys={"summary"}, require_output_contract=True)
    plan.output_contract = TeamOutputContract(fields=[TeamOutputField(path=["summary"], type="string")])
    plan.response = '{"summary":"A valid summary"}'
    assert _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                                 output_keys={"summary"}, require_output_contract=True)


def test_genuine_clarification_can_precede_a_strict_json_deliverable():
    from backend.services.agent_team_runtime import _validate_plan_result
    plan = TeamPlan(response="Which report should I summarize?", response_kind="clarification")
    assert _validate_plan_result(plan.model_dump_json(), allow_response=True, members=[], owner_id="director",
                                 output_keys={"summary"}, require_output_contract=True)


def test_initial_greeting_requires_no_prior_goal_sources_or_grants():
    assert initial_greeting({"request":"Hola!", "context_refs":{"count":0}})
    assert not initial_greeting({"request":"Hola, calcula el camp total", "context_refs":{"count":0}})
    assert not initial_greeting({"request":"Hola", "recent_conversation":[{"role":"human","text":"Which value?"}]})
    assert not initial_greeting({"request":"Hola", "context_refs":{"count":1}})


def test_clarification_discards_generated_assignments_without_executing_them():
    from backend.services.agent_team_runtime import _validate_plan_result
    raw = table_plan().model_dump()
    raw.update(response_kind="clarification", response="Quin camp vols?", output_contract=None)
    normalized = json.loads(_validate_plan_result(json.dumps(raw), allow_response=True, members=members(), owner_id="director"))
    assert normalized["response"] == "Quin camp vols?" and normalized["tasks"] == []
    assert not normalized["result_task"] and normalized["synthesize"] is False


def test_dynamic_and_nonplanning_contracts_remain_in_the_prompt():
    from backend.services.agent_behavior import operation_input
    from backend.services.agent_execution_models import AgentOperation
    request = AgentOperation(skill_id="core.gnosi-coordination", operation="team.plan", output_schema={"type": "object"})
    assert "output_schema" in json.loads(operation_input(request, provider="openrouter"))
    request.operation = "team.repair"
    request.output_schema = BOOLEAN
    assert "output_schema" in json.loads(operation_input(request, provider="openrouter"))


def table_plan():
    return TeamPlan(operation="tables", output_contract=TeamOutputContract(fields=[TeamOutputField(path=["value"], type="boolean")]),
                    tasks=[TeamTask(id="field", agent_id="worker", objective="Compute the requested typed field",
                                    skill_ids=["core.gnosi-operation-tables"])], result_task="field")


def members():
    return [{"id": identifier, "available": True, "skills": [skill], "capabilities": []}
            for identifier, skill in (("writer", "core.gnosi-operation-writing"),
                                      ("worker", "core.gnosi-operation-tables"))]


def test_table_operation_cannot_be_assigned_to_writing_even_with_valid_json():
    plan = table_plan()
    plan.tasks[0].agent_id = "writer"
    plan.tasks[0].skill_ids = ["core.gnosi-operation-writing"]
    with pytest.raises(ValueError, match="operation_skill_required"):
        validate_plan_contract(plan, members(), "director")


@pytest.mark.parametrize("response", ['{"value":false}', '{\u200b'])
def test_coordinator_cannot_bypass_available_specialist_with_a_json_response(response):
    with pytest.raises(ValueError, match="specialist_required"):
        validate_plan_contract(TeamPlan(operation="tables", response=response, response_kind="conversation"),
                               members(), "director")


def test_clarification_and_greeting_remain_possible_but_unavailability_is_checked():
    validate_plan_contract(TeamPlan(operation="tables", response="Quin camp?", response_kind="clarification"), members(), "director")
    validate_plan_contract(TeamPlan(response="Hola!", response_kind="greeting"), members(), "director")
    with pytest.raises(ValueError, match="specialist_required"):
        validate_plan_contract(TeamPlan(operation="tables", response="No hi ha aquesta habilitat.", response_kind="unavailable"), members(), "director")
    unavailable = [{**m, "available": False} for m in members()]
    validate_plan_contract(TeamPlan(operation="tables", response="No hi ha aquesta habilitat.", response_kind="unavailable"), unavailable, "director")


def test_operation_checks_respect_personal_skill_aliases_and_server_operation():
    plan = table_plan()
    plan.tasks[0].skill_ids = ["user.fields"]
    catalog = [{"id": "worker", "available": True, "skills": ["user.fields"], "capabilities": [{
        "id": "user.fields", "canonical_id": "core.gnosi-operation-tables", "available": True,
        "application_operation": "tables"}]}]
    validate_plan_contract(plan, catalog, "director", required_operation="tables")
    with pytest.raises(ValueError, match="operation_mismatch"):
        validate_plan_contract(plan, catalog, "director", required_operation="writing")


@pytest.mark.parametrize("invalid", [{"type": "nonsense"}, {"$ref": "https://example.test/schema"},
                                      {"type": "string", "pattern": "(a+)+"}])
def test_raw_schema_keywords_cannot_enter_the_typed_contract(invalid):
    with pytest.raises(ValueError):
        TeamPlan(response="hello", output_contract=invalid)


def test_contract_rejects_scalar_paths_and_choices_of_the_wrong_type():
    for contract in [TeamOutputContract(type="boolean", fields=[TeamOutputField(path=["value"], type="boolean")]),
                     TeamOutputContract(fields=[TeamOutputField(path=["value"], type="number", choices=["bad"])])]:
        with pytest.raises(ValueError, match="output_contract_invalid"):
            output_schema(TeamPlan(response="hello", output_contract=contract))


def test_reference_names_in_data_fields_are_not_schema_references():
    contract = TeamOutputContract(fields=[TeamOutputField(path=["$ref"], type="string")])
    assert output_schema(TeamPlan(response="hello", output_contract=contract))["properties"]["$ref"] == {"type": "string"}


def test_nested_array_contract_is_built_locally_with_exact_types():
    from backend.services.json_contracts import validate_json_value
    from jsonschema import ValidationError
    contract = TeamOutputContract(fields=[
        TeamOutputField(path=["classifications"], type="array"),
        TeamOutputField(path=["classifications", "*", "id"], type="string"),
        TeamOutputField(path=["classifications", "*", "values"], type="array"),
        TeamOutputField(path=["classifications", "*", "values", "*"], type="string", choices=["entity", "idea"]),
    ])
    schema = output_schema(TeamPlan(response="hello", output_contract=contract))
    validate_json_value({"classifications": [{"id": "n1", "values": ["entity"]}]}, schema)
    with pytest.raises(ValidationError):
        validate_json_value({"classifications": [{"id": "n1", "values": [False]}]}, schema)


def test_array_choices_restrict_items_and_still_reject_other_values():
    from backend.services.json_contracts import validate_json_value
    from jsonschema import ValidationError
    contract = TeamOutputContract(fields=[TeamOutputField(path=["values"], type="array", choices=["entity", "idea"])])
    schema = output_schema(TeamPlan(response="hello", output_contract=contract))
    validate_json_value({"values": ["entity"]}, schema)
    with pytest.raises(ValidationError):
        validate_json_value({"values": ["other"]}, schema)
    contract.fields.append(TeamOutputField(path=["values", "*"], type="boolean"))
    with pytest.raises(ValueError, match="choices must match"):
        output_schema(TeamPlan(response="hello", output_contract=contract))


def test_array_choices_are_checked_against_subsequently_declared_object_items():
    contract = TeamOutputContract(fields=[
        TeamOutputField(path=["classifications"], type="array", choices=["array"]),
        TeamOutputField(path=["classifications", "*", "id"], type="string"),
    ])
    with pytest.raises(ValueError, match="choices must match"):
        output_schema(TeamPlan(response="hello", output_contract=contract))


def prepare(fixture, monkeypatch, outputs):
    from backend.domains.agent import workflow
    fixture[1].profile["team"]["direct_routes"] = []
    fixture[3]["agents"][1]["skill_ids"] = ["core.gnosi-operation-tables"]
    fixture[3]["_responses"] = {"director": [AIMessage(content=table_plan().model_dump_json())],
                               "worker": [AIMessage(content=output) for output in outputs]}
    resolve = workflow.resolve_model
    models = {}
    def shared_model(profile, **kwargs):
        identifier = profile.agent_data["id"]
        if identifier not in models:
            models[identifier] = resolve(profile, **kwargs)
        return models[identifier]
    monkeypatch.setattr(workflow, "resolve_model", shared_model)


def test_valid_json_completes_without_an_extra_model_call(optional_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":false}'])
    messages, _ = run_chat(fixture, "Calcula el camp booleà completat de subtasques=[true,false]. Retorna JSON value; no desis res.")
    assert fixture[2] == ["director", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "validated"
    assert all(run.status == "completed" for run in store.list_runs(fixture[0]))
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1


def test_explicit_contract_constrains_native_planning_without_preventing_clarification(optional_runtime, monkeypatch):
    from jsonschema import Draft202012Validator
    from backend.services import agent_execution_store as store
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":false}'])
    run_chat(fixture, 'Calcula el camp booleà. Contracte: {"value":false}.')
    with store.connect() as db:
        requests = [json.loads(row[0]) for row in db.execute("SELECT request FROM agent_runs")]
    schema = next(request["output_schema"] for request in requests if request.get("operation") == "team.plan")
    validator = Draft202012Validator(schema)
    validator.validate(table_plan().model_dump())
    raw = table_plan().model_dump()
    for invalid in [{"type": "object"}, {"type": "object", "fields": [], "allow_extra_keys": False}]:
        raw["output_contract"] = invalid
        assert not validator.is_valid(raw)
    validator.validate(TeamPlan(operation="tables", response_kind="clarification", response="Quin camp?").model_dump())


@pytest.mark.parametrize("invalid", ['{\u200b', '{"value":"false"}', '{"value":false,"other":1}'])
def test_invalid_json_is_repaired_once_by_the_same_executor_before_completion(optional_runtime, monkeypatch, invalid):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, [invalid, '{"value":false}'])
    messages, _ = run_chat(fixture, "Calcula el camp booleà completat de subtasques=[true,false]. Retorna JSON value; no desis res.")
    assert fixture[2] == ["director", "worker", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}
    assert messages[-1].additional_kwargs["gnosi_team_output"]["status"] == "repaired"
    runs = store.list_runs(fixture[0])
    repair = next(run for run in runs if run.operation == "team.repair")
    assert repair.agent_id == "worker" and repair.status == "completed" and repair.model_calls == 1
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1
    assert not artifacts.list_artifacts(fixture[0], "replan")
    with store.connect() as db:
        request = json.loads(db.execute("SELECT request FROM agent_runs WHERE run_id=?", (repair.run_id,)).fetchone()[0])
        assert request["tool_mode"] == "none" and request["max_model_calls"] == 1
        assert "subtasques=[true,false]" in request["data"]["original_input"]
    usage = messages[-1].additional_kwargs["gnosi_team_usage"]
    assert usage["phases"]["repair"]["model_calls"] == 1


def test_failed_repair_is_a_failed_run_and_does_not_rerun_the_task(optional_runtime, monkeypatch):
    from backend.services import agent_execution_store as store, agent_team_store as artifacts
    from backend.services.agent_team_output import TeamOutputContractError
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":"false"}', '{"value":"false"}'])
    with pytest.raises(TeamOutputContractError):
        run_chat(fixture, "Calcula el camp booleà. Retorna JSON value.")
    assert fixture[2] == ["director", "worker", "worker"]
    assert not artifacts.list_artifacts(fixture[0], "replan")
    assert len(artifacts.list_artifacts(fixture[0], "task")) == 1
    assert all(run.status == "failed" for run in store.list_runs(fixture[0]) if run.operation != "team.plan")


@pytest.mark.parametrize("bad_plan", ["writer", "direct_response"])
def test_invalid_operation_plan_is_repaired_before_an_executor_runs(optional_runtime, monkeypatch, bad_plan):
    fixture, _ = optional_runtime
    prepare(fixture, monkeypatch, ['{"value":false}'])
    if bad_plan == "writer":
        invalid = table_plan()
        writer = {**fixture[3]["agents"][1], "id": "writer", "skill_ids": ["core.gnosi-operation-writing"]}
        fixture[3]["agents"].append(writer)
        fixture[1].profile["team"]["members"].append({"agent_id": "writer", "roles": ["expert"]})
        invalid.tasks[0].agent_id = "writer"
        invalid.tasks[0].skill_ids = ["core.gnosi-operation-writing"]
    else:
        invalid = TeamPlan(operation="tables", response='{"value":false}', response_kind="conversation")
    fixture[3]["_responses"]["director"] = [AIMessage(content=invalid.model_dump_json()),
                                             AIMessage(content=table_plan().model_dump_json())]
    messages, _ = run_chat(fixture, "Calcula el camp booleà. Retorna JSON value.")
    assert fixture[2] == ["director", "director", "worker"]
    assert json.loads(messages[-1].content) == {"value": False}


def test_synthesis_json_has_one_bounded_action_free_repair(optional_runtime):
    import asyncio
    from backend.services import agent_execution_store as store, agent_team_runtime as teams
    from backend.services.agent_execution_models import AgentRun
    from backend.services.agent_execution_scope import execution_scope
    fixture, _ = optional_runtime
    scope, snapshot, calls, config = fixture
    config["_responses"] = {"director": [AIMessage(content='{"value":"false"}'), AIMessage(content='{"value":false}')]}
    store.create(AgentRun(run_id="synthesis-root", agent_id="director", skill_id="", operation="conversation",
                         origin="chat", status="running", created_at=0, updated_at=0), scope, {}, snapshot.model_dump())
    with execution_scope(scope):
        result = asyncio.run(teams._phase(snapshot.profile, "synthesis-root", scope,
                             '{"request":"Return the boolean value from completed evidence"}', BOOLEAN, "team.synthesis"))
    assert json.loads(result) == {"value": False} and calls == ["director", "director"]
    phase = next(run for run in store.list_runs(scope) if run.operation == "team.synthesis")
    assert phase.status == "completed" and phase.model_calls == 2
    with store.connect() as db:
        request = json.loads(db.execute("SELECT request FROM agent_runs WHERE run_id=?", (phase.run_id,)).fetchone()[0])
        assert request["tool_mode"] == "none" and request["max_model_calls"] == 2
