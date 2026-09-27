"""Reviewable retention evidence; task instructions never become permanent defaults."""
from __future__ import annotations
from typing import Any


def reusable_instructions(skill_ids: list[str]) -> str:
    # Only registered identifiers are interpolated, never model-generated task text.
    import re
    safe = [s for s in skill_ids if re.fullmatch(r'[a-zA-Z0-9_.-]{1,128}', s)]
    return ('You are a reusable specialist for these authorized skills: ' + ', '.join(safe)
            + '. Follow the current user request and the registered skill instructions. '
            'Ask for missing task context. Use only authorized sources and actions; respect confirmations. '
            'State evidence, uncertainty and acceptance checks. Do not assume facts from previous tasks.')


def retention_details(spec: dict[str, Any], profiles: list[dict[str, Any]], run: Any) -> dict[str, Any]:
    required = set(spec['skill_ids'])
    comparisons = []
    for profile in profiles:
        if str(profile.get('id', '')).startswith('temporary_'):
            continue
        skills = set(profile.get('skill_ids', []))
        comparisons.append({'agent_id': profile['id'], 'name': profile.get('name') or profile['id'],
            'missing_skills': sorted(required - skills),
            'same_instructions': str(profile.get('persona') or '').strip() == str(spec['instructions']).strip(),
            'same_model': (profile.get('provider'), profile.get('model')) == (spec['provider'], spec['model']),
            'available': bool(profile.get('enabled', True) and not profile.get('plugin_suspended'))})
    equivalent = [p['agent_id'] for p in comparisons if not p['missing_skills'] and p['same_model'] and p['same_instructions'] and p['available']]
    return {'instructions': reusable_instructions(spec['skill_ids']),
            'rationale': 'agent_team.reuse_specialty', 'reusable_skills': sorted(required),
            'comparisons': comparisons, 'equivalent_agent_ids': equivalent,
            'verified_results': [{'run_id': run.run_id, 'status': run.status,
                'check': 'agent_team.completed_execution_only'}],
            'limitations': ['agent_team.proposal_limitation', 'agent_team.acceptance_not_certified'],
            'instructions_origin': 'registered_skills_template_v1'}
