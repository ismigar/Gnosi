"""Single ordered registry for every public Gnosi router."""

from __future__ import annotations

from fastapi import Depends, FastAPI

from backend.api import (
    agent_routes,
    agent_skills_routes,
    ai_routes,
    analytics_routes,
    auth_routes,
    calendar_routes,
    collab_routes,
    config_routes,
    contacts_routes,
    credentials_routes,
    env_routes,
    google_auth_routes,
    handwriting_routes,
    identity_routes,
    integrations_routes,
    literature_routes,
    mail_routes,
    meeting_routes,
    microsoft_auth_routes,
    notebook_routes,
    notion_oauth_routes,
    notion_routes,
    planning_routes,
    public_routes,
    reader,
    scheduler_routes,
    share_routes,
    social_routes,
    system_routes,
    tools_routes,
    vault_graph_routes,
    vault_routes,
    vault_templates_routes,
    vault_views_routes,
    vaults_routes,
    workspace_routes,
)
from backend.services.plugin_access import require_plugins


def register_routers(app: FastAPI) -> None:
    """Register routers in the exact legacy matching order."""
    app.include_router(workspace_routes.router, tags=["Workspaces"])

    app.include_router(
        agent_routes.router,
        prefix="/api",
        dependencies=[Depends(require_plugins("ai-platform"))],
    )
    app.include_router(
        notebook_routes.router,
        dependencies=[Depends(require_plugins("grounded-notebooks", "ai-platform"))],
    )
    app.include_router(system_routes.router, prefix="/api/system")
    app.include_router(
        social_routes.router,
        prefix="/api/social",
        tags=["Social"],
        dependencies=[Depends(require_plugins("social-publishing"))],
    )

    app.include_router(vault_routes.router, prefix="/api/vault", tags=["Vault"])
    app.include_router(
        planning_routes.router,
        prefix="/api",
        tags=["Project Planning"],
        dependencies=[Depends(require_plugins("project-planning"))],
    )
    app.include_router(
        literature_routes.router,
        dependencies=[Depends(require_plugins("resources"))],
    )
    app.include_router(handwriting_routes.router, tags=["Handwriting"])
    app.include_router(vault_graph_routes.router, prefix="/api", tags=["Vault Graph"])
    app.include_router(vault_views_routes.router, prefix="/api", tags=["Vault Views"])
    app.include_router(collab_routes.router, prefix="/api/vault", tags=["Collaboration"])
    app.include_router(share_routes.router, prefix="/api", tags=["Share"])

    app.include_router(
        calendar_routes.router,
        tags=["Calendar"],
        dependencies=[Depends(require_plugins("calendar"))],
    )
    app.include_router(
        mail_routes.router,
        tags=["Mail"],
        dependencies=[Depends(require_plugins("mail"))],
    )
    app.include_router(
        reader.router,
        tags=["Reader"],
        dependencies=[Depends(require_plugins("feeds-reader"))],
    )
    app.include_router(
        meeting_routes.router,
        tags=["Meetings"],
        dependencies=[Depends(require_plugins("calendar", "ai-platform"))],
    )
    app.include_router(
        tools_routes.router,
        tags=["Tools"],
        dependencies=[Depends(require_plugins("ai-platform"))],
    )
    app.include_router(analytics_routes.router, tags=["Analytics"])
    app.include_router(
        scheduler_routes.router,
        tags=["Scheduler"],
        dependencies=[Depends(require_plugins("automations"))],
    )
    app.include_router(
        contacts_routes.router,
        prefix="/api",
        tags=["Contacts"],
        dependencies=[Depends(require_plugins("contacts"))],
    )
    app.include_router(public_routes.router, prefix="/api", tags=["Public API / PAT"])

    app.include_router(google_auth_routes.router, tags=["Auth"])
    app.include_router(microsoft_auth_routes.router, tags=["Auth"])
    app.include_router(integrations_routes.router, tags=["Integrations"])
    app.include_router(auth_routes.router, tags=["Auth"])
    app.include_router(config_routes.router, prefix="/api", tags=["Config"])
    app.include_router(env_routes.router, prefix="/api", tags=["Env"])
    app.include_router(credentials_routes.router, prefix="/api", tags=["Credentials"])
    app.include_router(
        ai_routes.router,
        prefix="/api",
        tags=["AI Settings"],
        dependencies=[Depends(require_plugins("ai-platform"))],
    )
    app.include_router(
        agent_skills_routes.router,
        prefix="/api",
        tags=["AI Skills"],
        dependencies=[Depends(require_plugins("ai-platform"))],
    )
    app.include_router(
        notion_routes.router,
        prefix="/api",
        tags=["Notion Import"],
        dependencies=[Depends(require_plugins("notion-import"))],
    )
    app.include_router(
        notion_oauth_routes.router,
        prefix="/api",
        tags=["Notion MCP OAuth"],
        dependencies=[Depends(require_plugins("notion-import"))],
    )
    app.include_router(vaults_routes.router, prefix="/api", tags=["Vaults"])
    app.include_router(
        vault_templates_routes.router,
        prefix="/api",
        tags=["Vault templates"],
    )
    app.include_router(identity_routes.router, tags=["Identity"])
