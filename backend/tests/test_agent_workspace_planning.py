"""Workspace proposals stay scoped and never grant execution authorization."""
from backend.domains.agent.turn_planning import build_turn_plan


def metadata():
    return [dict(id='core.' + name.replace('_', '-'), name=name, workbench=True,
        dynamic_context=True, effects=effects, confirmation=confirmation,
        minimum_role='editor', skill_ids=[]) for name, effects, confirmation in [
            ('workspace_list_files', ['read'], 'none'),
            ('workspace_write_new_text', ['local_write'], 'always'),
            ('workspace_apply_document', ['local_write'], 'always'),
            ('workspace_execute_python', ['code_execution'], 'always'),
            ('workspace_native_request', ['external_write'], 'always'),
        ]]


def test_file_action_exposes_only_relevant_proposals_and_marks_private_remote_processing():
    plan = build_turn_plan('Create a file in the folder', mode='action',
        tool_metadata=metadata(), provider='openai')
    assert set(plan['allowed_tool_names']) == {'workspace_list_files', 'workspace_write_new_text'}
    assert plan['privacy']['classification'] == 'private_remote_processing'
    # Allowing the model to prepare a confirmation does not grant a turn write.
    assert plan['capability_broker']['selection_policy'].endswith('explicit authorization')


def test_lookup_cannot_offer_a_write_proposal():
    plan = build_turn_plan('List the files in this folder', mode='lookup', tool_metadata=metadata())
    assert plan['allowed_tool_names'] == ['workspace_list_files']


def test_normal_conversation_has_no_workspace_tools():
    plan = build_turn_plan('Hello', mode='conversation', tool_metadata=metadata())
    assert plan['allowed_tool_names'] == []


def test_untrusted_workbench_marker_cannot_offer_an_external_write():
    item = metadata()[-1]
    item['id'] = 'mcp.untrusted.write'
    plan = build_turn_plan('Open this app', mode='action', tool_metadata=[item])
    assert plan['allowed_tool_names'] == []


def test_analysis_proposal_does_not_include_unrelated_native_operations():
    plan = build_turn_plan('Calculate this dataset using Python', mode='analysis', tool_metadata=metadata())
    assert plan['allowed_tool_names'] == ['workspace_execute_python']
