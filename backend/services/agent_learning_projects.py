"""Private project context and conversation bindings for agent learning."""

from __future__ import annotations

import json
import sqlite3
import uuid

from backend.services.agent_learning_models import LearningProject, LearningWorkspace, ProjectDraft
from backend.services.agent_personal_memory import _connect, _now, _scope
from backend.services.workspace_service import WorkspaceContext


def owner_key(context: WorkspaceContext, agent_id: str) -> str:
    return _scope(context.vault_path, f"{context.workspace_id}\0{agent_id}", context.user_id)


def _project(row: sqlite3.Row) -> LearningProject:
    payload = ProjectDraft.model_validate_json(str(row["payload"]))
    return LearningProject(
        **payload.model_dump(exclude={"expected_revision"}),
        id=str(row["id"]), revision=int(row["revision"]), updated_at=str(row["updated_at"]),
    )


def workspace(context: WorkspaceContext, agent_id: str, session_id: str = "") -> LearningWorkspace:
    owner = owner_key(context, agent_id)
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM learning_projects WHERE owner_hash=? ORDER BY updated_at DESC LIMIT 200",
            (owner,),
        ).fetchall()
        binding = connection.execute(
            "SELECT project_id FROM learning_sessions WHERE owner_hash=? AND session_id=?",
            (owner, session_id),
        ).fetchone()
    return LearningWorkspace(
        projects=[_project(row) for row in rows],
        project_id=str(binding["project_id"]) if binding else "",
    )


def get_project(context: WorkspaceContext, agent_id: str, project_id: str) -> LearningProject:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM learning_projects WHERE owner_hash=? AND id=?",
            (owner_key(context, agent_id), project_id),
        ).fetchone()
    if row is None:
        raise LookupError("Project not found.")
    return _project(row)


def save_project(
    context: WorkspaceContext, agent_id: str, draft: ProjectDraft, project_id: str = "",
) -> LearningProject:
    owner = owner_key(context, agent_id)
    payload = draft.model_dump_json(exclude={"expected_revision"})
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if project_id:
            if draft.expected_revision is None:
                raise ValueError("A project revision is required.")
            cursor = connection.execute(
                """UPDATE learning_projects SET payload=?, revision=revision+1, updated_at=?
                WHERE id=? AND owner_hash=? AND revision=?""",
                (payload, _now(), project_id, owner, draft.expected_revision),
            )
            if cursor.rowcount != 1:
                raise ValueError("Project changed or no longer exists.")
        else:
            count = connection.execute(
                "SELECT count(*) FROM learning_projects WHERE owner_hash=?", (owner,),
            ).fetchone()[0]
            if count >= 200:
                raise ValueError("The project limit has been reached.")
            project_id = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO learning_projects(id, owner_hash, payload, updated_at) VALUES (?, ?, ?, ?)",
                (project_id, owner, payload, _now()),
            )
    return get_project(context, agent_id, project_id)


def bind_project(context: WorkspaceContext, agent_id: str, session_id: str, project_id: str) -> None:
    owner = owner_key(context, agent_id)
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if project_id and not connection.execute(
            "SELECT 1 FROM learning_projects WHERE owner_hash=? AND id=?", (owner, project_id),
        ).fetchone():
            raise LookupError("Project not found.")
        if project_id:
            connection.execute(
                """INSERT INTO learning_sessions VALUES (?, ?, ?)
                ON CONFLICT(owner_hash, session_id) DO UPDATE SET project_id=excluded.project_id""",
                (owner, session_id, project_id),
            )
        else:
            connection.execute(
                "DELETE FROM learning_sessions WHERE owner_hash=? AND session_id=?", (owner, session_id),
            )


def delete_project(context: WorkspaceContext, agent_id: str, project_id: str) -> None:
    owner = owner_key(context, agent_id)
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        cursor = connection.execute(
            "DELETE FROM learning_projects WHERE owner_hash=? AND id=?", (owner, project_id),
        )
        if cursor.rowcount != 1:
            raise LookupError("Project not found.")
        connection.execute(
            "DELETE FROM learning_sessions WHERE owner_hash=? AND project_id=?", (owner, project_id),
        )
        connection.execute(
            """UPDATE personal_memories SET enabled=0, revision=revision+1, updated_at=?
            WHERE scope_hash=? AND scope_kind='project' AND scope_id=?""",
            (_now(), _scope(context.vault_path, agent_id, context.user_id), project_id),
        )


def project_prompt(project: LearningProject) -> str:
    """Include instructions and result references as bounded data, never authority."""
    return json.dumps({
        "name": project.name,
        "instructions": project.instructions,
        "result_references": project.results,
    }, ensure_ascii=False)[:12_000]
