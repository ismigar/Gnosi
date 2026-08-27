"""Stable identities for each Gnosi-owned Alembic revision line."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MigrationFamily:
    """One independent database schema and Alembic branch."""

    name: str
    branch: str
    revisions: tuple[str, ...]

    @property
    def head(self) -> str:
        """Return the immutable head revision for this family."""
        return self.revisions[-1]


FAMILIES = {
    family.name: family
    for family in (
        MigrationFamily(
            "management",
            "management",
            (
                "mgmt_0001",
                "mgmt_0002",
                "mgmt_0003",
                "mgmt_0004",
                "mgmt_0005",
            ),
        ),
        MigrationFamily(
            "vault",
            "vault",
            ("vault_0001", "vault_0002", "vault_0003"),
        ),
        MigrationFamily(
            "notebooks",
            "notebooks",
            (
                "notebooks_0001",
                "notebooks_0002",
                "notebooks_0003",
                "notebooks_0004",
                "notebooks_0005",
            ),
        ),
        MigrationFamily(
            "action_confirmations",
            "action_confirmations",
            ("actions_0001", "actions_0002"),
        ),
        MigrationFamily(
            "model_evaluations",
            "model_evaluations",
            ("evaluations_0001",),
        ),
        MigrationFamily("capability_health", "capability_health", ("health_0001",)),
        MigrationFamily("durable_jobs", "durable_jobs", ("jobs_0001",)),
        MigrationFamily(
            "personal_memory",
            "personal_memory",
            ("personal_memory_0001",),
        ),
        MigrationFamily("quality_telemetry", "quality_telemetry", ("quality_0001",)),
        MigrationFamily("agent_replay", "agent_replay", ("replay_0001",)),
        MigrationFamily(
            "semantic_memory",
            "semantic_memory",
            ("semantic_memory_0001",),
        ),
        MigrationFamily("stream_journal", "stream_journal", ("stream_journal_0001",)),
        MigrationFamily("turn_claims", "turn_claims", ("turns_0001",)),
        MigrationFamily(
            "capability_audit",
            "capability_audit",
            ("capability_audit_0001",),
        ),
        MigrationFamily(
            "capability_automations",
            "capability_automations",
            ("automations_0001",),
        ),
        MigrationFamily("tool_registry", "tool_registry", ("tool_registry_0001",)),
    )
}


def migration_family(name: str) -> MigrationFamily:
    """Resolve one known migration family or fail without touching a database."""
    try:
        return FAMILIES[name]
    except KeyError as exc:
        known = ", ".join(sorted(FAMILIES))
        raise ValueError(f"Unknown migration family {name!r}; expected one of: {known}") from exc
