"""Assigned skill preferences drive episode length and routing without losing scope."""
import json
from types import SimpleNamespace

import jsonschema
import pytest

from backend.models.agent_skills import CatalogOrigin, OriginType, SkillCatalogEntry, SkillDescriptor
from backend.services.agent_behavior import task_input
from backend.services.agent_behavior_bindings import effective_entries
from backend.services.agent_execution_models import AgentOperation
from backend.services.podcast_briefing import _Briefing
from backend.services.podcast_outline import _plan_request, _route
from backend.services.podcast_policy import SKILL_ID, preferences
from backend.tests.test_podcast_briefing import pipeline  # noqa: F401


def instructions(values):
    return 'Use a concise, accessible style.\n\n```json\n' + json.dumps({'podcast_preferences': values}) + '\n```\n'


def context(values):
    return SimpleNamespace(snapshot=SimpleNamespace(skill_instructions={SKILL_ID: instructions(values)}))


def test_builtin_defaults_keep_ten_minutes_with_flexible_grouping():
    policy = preferences(None)
    assert policy.duration_minutes == 10
    assert policy.max_topic_groups == 12
    assert policy.word_target(208) == 1380
    assert policy.word_target(1) == 160
    assert policy.word_target(3) == 195


def test_personalized_skill_controls_actual_numeric_preferences():
    original = SkillDescriptor(id=SKILL_ID, name='Daily podcast',
        origin=CatalogOrigin(type=OriginType.CORE, id='gnosi'), instructions='Original instructions')
    personal = SkillDescriptor(id='user.daily-podcast', name='My podcast',
        origin=CatalogOrigin(type=OriginType.USER, id='alice'),
        instructions=instructions({'duration_minutes': 5, 'max_topic_groups': 3,
            'short_day': {'full_episode_from_articles': 5, 'words_per_article': 40, 'minimum_words': 25}}),
        metadata={'derived_from': {'id': SKILL_ID}})
    entries = {d.id: SkillCatalogEntry(descriptor=d, available=True, revision=d.id)
               for d in [original, personal]}
    assigned, resolved, _ = effective_entries({'skill_ids': [SKILL_ID, personal.id]}, entries)
    assert assigned == [SKILL_ID]
    snapshot = SimpleNamespace(skill_instructions={SKILL_ID: resolved[SKILL_ID].descriptor.instructions})
    policy = preferences(SimpleNamespace(snapshot=snapshot))
    assert policy.word_target(10) == 690
    assert policy.word_target(2) == 80
    assert policy.max_topic_groups == 3
    assert original.instructions == 'Original instructions'


def test_partial_personalization_inherits_defaults_and_legacy_text_remains_compatible():
    policy = preferences(context({'duration_minutes': 5, 'short_day': {'words_per_article': 30}}))
    assert policy.word_target(25) == 690
    assert policy.max_topic_groups == 12
    assert policy.short_day.minimum_words == 160
    assert policy.short_day.words_per_article == 30
    legacy = SimpleNamespace(snapshot=SimpleNamespace(skill_instructions={SKILL_ID: 'Legacy prose.'}))
    assert preferences(legacy) == preferences(None)


def test_other_skills_profile_context_and_source_text_cannot_configure_the_podcast():
    unrelated = instructions({'duration_minutes': 60, 'max_topic_groups': 32})
    snapshot = SimpleNamespace(skill_instructions={'user.unrelated': unrelated},
                               instructions=[unrelated], profile={'context': unrelated})
    assert preferences(SimpleNamespace(snapshot=snapshot, sources=[unrelated])) == preferences(None)


@pytest.mark.parametrize('values', [
    {'duration_minutes': 0}, {'duration_minutes': 61}, {'duration_minutes': True},
    {'duration_minutes': '5'}, {'max_topic_groups': 0}, {'max_topic_groups': 33},
    {'disable_validation': True}, {'short_day': None}, {'short_day': {'minimum_words': -1}},
    {'short_day': {'disable_review': True}},
])
def test_invalid_preferences_fail_before_any_model_call(pipeline, values):
    pipeline.snapshot.skill_instructions = {SKILL_ID: instructions(values)}
    with pytest.raises(ValueError):
        pipeline.run([{'id': 'a', 'title': 'Source', 'text': 'Original evidence.'}])
    assert pipeline.calls == []


@pytest.mark.parametrize('body', [
    '```json\n{"podcast_preferences": {"duration_minutes": 5,}}\n```',
    '```json\n{"podcast_preferences": {}, "podcast_preferences": {}}\n```',
    '```json\n{"podcast_preferences": {}, "extra": {}}\n```',
    '```json\n{"podcast_preferences": []}\n```',
    '```json\n{"podcast_preferences": {}}',
    '```json\n{"podcast_preferences": {}}\n```\n```json\n{"podcast_preferences": {}}\n```',
])
def test_malformed_or_ambiguous_preferences_never_silently_fall_back(body):
    with pytest.raises(ValueError, match='podcast_skill_preferences'):
        preferences(SimpleNamespace(snapshot=SimpleNamespace(skill_instructions={SKILL_ID: body})))


def test_briefing_freezes_preferences_for_the_job():
    snapshot = SimpleNamespace(skill_instructions={SKILL_ID: instructions({'duration_minutes': 5})})
    ctx = _Briefing(snapshot, 'Catalan', 80000, len, lambda: None)
    snapshot.skill_instructions[SKILL_ID] = instructions({'duration_minutes': 20})
    assert preferences(ctx).duration_minutes == 5
    assert preferences(_Briefing(snapshot, 'Catalan', 80000, len, lambda: None)).duration_minutes == 20


class Planner:
    def __init__(self, values, result):
        self.snapshot = context(values).snapshot
        self.result = result
        self.sent = []

    def request(self, operation, data, schema):
        return AgentOperation(skill_id=SKILL_ID, operation=operation,
                              input=task_input(operation, **data), output_schema=schema)

    def stage(self, request, validate):
        self.sent.append(request)
        jsonschema.validate(self.result, request.output_schema)
        validate(self.result)
        return self.result


def cards():
    return [{'part_ids': [f'source:{i}'], 'topic': f'Subject {i}', 'subjects': [f'Minority {i}']}
            for i in range(20)]


def test_planner_can_use_fewer_groups_and_retains_all_sources_and_child_subjects():
    source = cards()
    result = {'topics': ['First group', 'Second group'],
              'assignments': {f'card:{i}': i % 2 for i in range(20)}}
    ctx = Planner({'max_topic_groups': 3}, result)
    groups = _route(ctx, source)
    assert len(groups) == 2
    assert sorted(p for g in groups for p in g['part_ids']) == sorted(p for c in source for p in c['part_ids'])
    assert sorted(s for g in groups for s in g['subjects']) == sorted(s for c in source for s in c['subjects'])
    schema = ctx.sent[0].output_schema['properties']['topics']
    assert schema['minItems'] == 1 and schema['maxItems'] == 3
    assert ctx.sent[0].options['editorial_policy']['max_topic_groups'] == 3


def test_undeclared_topic_indices_fail_validation_instead_of_losing_cards():
    ctx = Planner({'max_topic_groups': 3}, {'topics': ['Only declared group'],
                  'assignments': {f'card:{i}': 2 for i in range(20)}})
    with pytest.raises(ValueError, match='podcast_outline_assignment_out_of_range'):
        _route(ctx, cards())


def test_personalization_changes_request_identity_even_for_a_legacy_snapshot_revision():
    first = Planner({'duration_minutes': 5}, {})
    second = Planner({'duration_minutes': 10}, {})
    assert _plan_request(first, cards()).model_dump() != _plan_request(second, cards()).model_dump()


def test_end_to_end_pipeline_uses_custom_duration_and_records_the_resolved_policy(pipeline):
    pipeline.snapshot.skill_instructions = {SKILL_ID: instructions({
        'duration_minutes': 2, 'max_topic_groups': 3, 'short_day': {'full_episode_from_articles': 1}})}
    script = pipeline.run([{'id': 'a', 'title': 'Source', 'text': 'Original evidence.'}])
    report = pipeline.saved['podcast-coverage-report']
    assert report['word_budget'] == 276 and 249 <= len(script.split()) <= 300
    assert report['editorial_policy']['duration_minutes'] == 2
    assert report['article_ids'] == ['a']
    assert any(c['task'] == 'podcast.coverage.audit' for c in pipeline.calls)


def test_windows_line_endings_preserve_editable_preferences():
    body = instructions({'duration_minutes': 5, 'max_topic_groups': 3}).replace('\n', '\r\n')
    policy = preferences(SimpleNamespace(snapshot=SimpleNamespace(skill_instructions={SKILL_ID: body})))
    assert policy.duration_minutes == 5 and policy.max_topic_groups == 3
