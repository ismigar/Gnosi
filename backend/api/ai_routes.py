import asyncio
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.config.app_config import load_params
from backend.security.ai_credentials import (
    get_ai_catalog_with_status,
    migrate_ai_provider_secrets,
    resolve_provider_api_key,
    sanitize_ai_config,
    set_provider_api_key,
)
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text


router = APIRouter(prefix="/ai", tags=["AI Settings"])

from backend.agent.factory import get_llm

class ValidatePayload(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

@router.post("/providers/{provider_id}/validate", dependencies=[Depends(require_role("admin"))])
async def validate_provider(provider_id: str, payload: ValidatePayload):
    """
    Attempts to validate the provider by making a simple 'ping' request.
    If api_key is provided in payload, it uses it. Otherwise, it uses the saved one.
    """
    provider = provider_id.lower().strip()
    
    # Resolve API Key
    api_key = payload.api_key
    if not api_key:
        api_key = resolve_provider_api_key(provider, {})
    
    if not api_key and provider not in ["ollama", "local", "generic"]:
        return {"success": False, "error": f"Falta la clau API per validar el proveïdor {provider.capitalize()}."}

    # Default models for validation
    default_models = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-sonnet-latest",
        "groq": "llama-3.3-70b-versatile",
        "google": "gemini-1.5-flash",
        "openrouter": "openai/gpt-4o-mini"
    }
    target_model = payload.model or default_models.get(provider)

    try:
        # timeout=10 s'aplica en construir el client (timeout REAL de xarxa). NO es pot
        # passar a .invoke() via config={"timeout":...}: langchain l'ignora i el «validar»
        # es penjaria si el proveïdor no respon. cf. directiva ai_error_handling.md.
        llm = get_llm(
            provider=provider,
            model=target_model,
            api_key=api_key,
            base_url=payload.base_url,
            timeout=10,
        )

        if not llm:
            return {"success": False, "error": f"No s'ha pogut instanciar el proveïdor {provider}. Revisa que la dependència o la clau API siguin correctos. Model: {target_model}"}

        # Intent d'invocació mínima — to_thread evita bloquejar l'event loop
        # (alguns LLMs no exposen `ainvoke` o el seu sync n'és el primary path).
        from langchain_core.messages import HumanMessage
        response = await asyncio.to_thread(
            llm.invoke,
            [HumanMessage(content="Digues 'ok'")],
        )

        return {"success": True, "response": response.content}
    except Exception as e:
        error_msg = str(e)
        if "API key" in error_msg:
            return {"success": False, "error": f"Clau API invàlida per a {provider.capitalize()}."}
        return {"success": False, "error": safe_error_detail(e, context=f"POST /ai/providers/{provider}/validate")}



# Note: We now fetch the dynamic path from app_config at runtime


class ProviderCredentialPayload(BaseModel):
    api_key: str
    base_url: Optional[str] = ""


@router.get("/catalog")
async def get_ai_catalog():
    cfg = load_params(strict_env=False)
    ai_cfg = dict(cfg.get("ai", {}) or {})
    return {
        "catalog": get_ai_catalog_with_status(ai_cfg),
        "config": sanitize_ai_config(ai_cfg),
    }


@router.post("/providers/{provider_id}/credentials", dependencies=[Depends(require_role("admin"))])
async def set_provider_credentials(provider_id: str, payload: ProviderCredentialPayload):
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")
    if not payload.api_key or not payload.api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required")

    ok, credential_ref = set_provider_api_key(provider, payload.api_key.strip())
    if not ok or not credential_ref:
        raise HTTPException(status_code=500, detail="Could not save provider credential")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})
    provider_cfg["credential_ref"] = credential_ref
    provider_cfg.pop("api_key", None)
    if payload.base_url is not None:
        provider_cfg["base_url"] = payload.base_url
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers

    migrated_ai_cfg, _ = migrate_ai_provider_secrets(ai_cfg)
    current_config["ai"] = migrated_ai_cfg

    # Atomic write: params.yaml conté tota la config principal de l'app
    # (incluint provider AI). Un crash a meitat el deixaria corrupte.
    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False,
        allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)

    return {
        "status": "success",
        "provider": provider,
        "credential_ref": credential_ref,
        "has_api_key": True,
    }

class ProviderStatusPayload(BaseModel):
    enabled: bool


@router.delete("/providers/{provider_id}", dependencies=[Depends(require_role("admin"))])
async def delete_provider(provider_id: str):
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    
    if provider in providers:
        providers.pop(provider)
        ai_cfg["providers"] = providers
        current_config["ai"] = ai_cfg

        yaml_text = yaml.safe_dump(
            current_config, default_flow_style=False,
            allow_unicode=True, sort_keys=False,
        )
        safe_write_text(params_path, yaml_text)
        return {"status": "success", "message": f"Provider {provider} deleted"}
    
    return {"status": "skipped", "message": f"Provider {provider} not found in config"}


@router.patch("/providers/{provider_id}/status", dependencies=[Depends(require_role("admin"))])
async def update_provider_status(provider_id: str, payload: ProviderStatusPayload):
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})
    
    provider_cfg["enabled"] = payload.enabled
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False,
        allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)

    return {"status": "success", "provider": provider, "enabled": payload.enabled}


# ---------------------------------------------------------------------------
# Registry de models del router (data-driven) + política de pressupost
# cf. backend/agent/model_router.py i directiva vault_knowledge_agents.md
# ---------------------------------------------------------------------------
class ModelsPayload(BaseModel):
    models: list
    budget: Optional[dict] = None


@router.get("/models")
async def get_model_registry():
    """Retorna el registry de models del router (config `ai.models`, o el per defecte)
    i la política de pressupost (`ai.budget`)."""
    from backend.agent.model_router import load_registry, DEFAULT_REGISTRY
    cfg = load_params(strict_env=False)
    ai_cfg = dict(cfg.get("ai", {}) or {})
    return {
        "models": load_registry(),
        "budget": dict(ai_cfg.get("budget") or {}),
        "default": DEFAULT_REGISTRY,
    }


@router.put("/models", dependencies=[Depends(require_role("admin"))])
async def set_model_registry(payload: ModelsPayload):
    """Desa el registry de models i la política de pressupost a params.yaml."""
    if not isinstance(payload.models, list):
        raise HTTPException(status_code=400, detail="models ha de ser una llista")
    # Validació mínima de cada entrada
    cleaned = []
    for m in payload.models:
        if not isinstance(m, dict) or not m.get("provider") or not m.get("model_id"):
            raise HTTPException(status_code=400, detail="cada model necessita provider i model_id")
        cleaned.append({
            "provider": str(m["provider"]).strip().lower(),
            "model_id": str(m["model_id"]).strip(),
            "is_local": bool(m.get("is_local", False)),
            "enabled": bool(m.get("enabled", True)),
            "priority": int(m.get("priority", 100)),
            "cost_in": float(m.get("cost_in", 0) or 0),
            "cost_out": float(m.get("cost_out", 0) or 0),
            "context_window": int(m.get("context_window", 8192) or 8192),
            "quality": int(m.get("quality", 2) or 2),
            "tags": [str(t) for t in (m.get("tags") or [])],
            **({"monthly_quota": int(m["monthly_quota"])} if m.get("monthly_quota") else {}),
            **({"endpoint": str(m["endpoint"])} if m.get("endpoint") else {}),
        })

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    ai_cfg["models"] = cleaned
    if payload.budget is not None:
        ai_cfg["budget"] = dict(payload.budget)
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False, allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)
    return {"status": "success", "count": len(cleaned)}


# ── Generació de contingut amb IA (per a l'editor del Vault) ──────────────────

class GeneratePayload(BaseModel):
    prompt: Optional[str] = ""
    context: Optional[str] = ""
    mode: Optional[str] = "free"   # free | continue | summarize | improve | translate
    language: Optional[str] = None


def _build_generation_prompt(payload: "GeneratePayload") -> str:
    """Construeix el prompt final segons el mode (presets estil Notion)."""
    instruction = (payload.prompt or "").strip()
    context = (payload.context or "").strip()
    mode = (payload.mode or "free").strip().lower()
    language = (payload.language or "").strip()

    style = (
        "Respon NOMÉS amb el contingut sol·licitat, en format Markdown net "
        "(títols, llistes, **negreta**, taules si cal). No afegeixis cap "
        "introducció tipus «Aquí tens…» ni embolcallis tota la resposta en un "
        "bloc de codi. Mantén el mateix idioma que el text d'entrada"
    )
    if mode == "translate" and language:
        style += f", excepte aquí: tradueix a {language}."
    else:
        style += "."

    if mode == "continue":
        body = (
            "Continua escrivint el text següent de manera natural i coherent, "
            "afegint un o dos paràgrafs nous. NO repeteixis el que ja hi ha.\n\n"
            f"--- TEXT ACTUAL ---\n{context}"
        )
    elif mode == "summarize":
        body = (
            "Fes un resum clar i estructurat (en punts si escau) del contingut "
            f"següent.\n\n--- CONTINGUT ---\n{context}"
        )
    elif mode == "improve":
        target = context or instruction
        body = (
            "Reescriu el text següent millorant-ne la redacció, la claredat i el "
            "to, sense canviar-ne el significat ni l'idioma.\n\n"
            f"--- TEXT ---\n{target}"
        )
    elif mode == "translate":
        target = context or instruction
        body = (
            f"Tradueix fidelment el text següent a {language or 'anglès'}.\n\n"
            f"--- TEXT ---\n{target}"
        )
    else:  # free
        if context:
            body = (
                f"{instruction}\n\nFes servir aquest context de la pàgina actual "
                f"com a referència si cal:\n--- CONTEXT ---\n{context}"
            )
        else:
            body = instruction or "Escriu un paràgraf útil sobre el tema."

    return f"{style}\n\n{body}"


@router.post("/generate")
async def generate_content(payload: GeneratePayload):
    """Generació one-shot de text amb IA per inserir-lo en pàgines del Vault.

    Usa el camí MODERN `factory.generate_text` (get_llm + resolve_provider_api_key),
    el mateix que l'agent i el botó «validar» de Configuració › IA. Cada crida és
    nova (no hi ha caché), així «continua escrivint» dues vegades dona text
    diferent. Degrada amb 503 si no hi ha cap proveïdor disponible, mai amb error
    dur.
    """
    from backend.agent.factory import generate_text

    final_prompt = _build_generation_prompt(payload)
    if not final_prompt.strip() or final_prompt.strip() == ".":
        raise HTTPException(status_code=400, detail="Cal un prompt o context.")

    try:
        content, provider = await asyncio.to_thread(
            generate_text, final_prompt, (payload.prompt or ""),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail="No hi ha cap proveïdor d'IA disponible. Revisa Configuració › IA.",
        ) from e
    except Exception as e:
        # Clau invàlida/caducada, rate-limit o permisos → missatge accionable.
        msg = str(e).lower()
        if any(k in msg for k in ("timeout", "timed out", "timed_out")):
            raise HTTPException(
                status_code=504,
                detail="El proveïdor d'IA no ha respost a temps. Torna-ho a provar.",
            ) from e
        if any(k in msg for k in (
            "authentication", "api key", "api_key", "invalid_api_key",
            "unauthor", "permission", "401", "403",
        )):
            raise HTTPException(
                status_code=503,
                detail="El proveïdor d'IA ha rebutjat la clau. Revisa Configuració › IA.",
            ) from e
        raise HTTPException(
            status_code=502,
            detail=safe_error_detail(e, context="POST /ai/generate"),
        )

    return {"content": (content or "").strip(), "provider": provider}


class CorrectPayload(BaseModel):
    text: str
    language: Optional[str] = None   # "català" | "castellà" | "anglès"… (pista opcional)
    scope: Optional[str] = "selection"  # selection | block | page (només per matís de prompt)


_LANG_LABELS = {
    "ca": "català",
    "es": "castellà",
    "en": "anglès",
}


@router.post("/correct")
async def correct_text(payload: CorrectPayload):
    """Corregeix ortografia i gramàtica d'un fragment amb IA.

    Germà de `/ai/generate` però amb un contracte estricte: retorna NOMÉS el text
    corregit, conservant sentit, to, idioma i format. Pensat per aplicar-se sobre
    una selecció, un bloc o una pàgina sencera de l'editor. Degrada amb 503 si no
    hi ha proveïdor, mai amb error dur.
    """
    from backend.agent.factory import generate_text

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Cal text per corregir.")

    hint = (payload.language or "").strip()
    lang_note = f" El text és en {_LANG_LABELS.get(hint, hint)}." if hint else ""

    prompt = (
        "Ets un corrector ortogràfic i gramatical. Corregeix el text següent: "
        "faltes d'ortografia, accents, puntuació, concordança i gramàtica."
        f"{lang_note} Conserva EXACTAMENT el mateix idioma, sentit, to i registre. "
        "No reescriguis l'estil ni resumeixis, no afegeixis ni treguis idees. "
        "Conserva el format Markdown, els salts de línia, els enllaços [[wiki]], "
        "les URL i el codi tal com estan. Respon NOMÉS amb el text corregit, "
        "sense cometes, sense explicacions ni comentaris.\n\n"
        f"--- TEXT ---\n{text}"
    )

    try:
        content, provider = await asyncio.to_thread(
            generate_text, prompt, text[:200],
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail="No hi ha cap proveïdor d'IA disponible. Revisa Configuració › IA.",
        ) from e
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("timeout", "timed out", "timed_out")):
            raise HTTPException(
                status_code=504,
                detail="El proveïdor d'IA no ha respost a temps. Torna-ho a provar.",
            ) from e
        if any(k in msg for k in (
            "authentication", "api key", "api_key", "invalid_api_key",
            "unauthor", "permission", "401", "403",
        )):
            raise HTTPException(
                status_code=503,
                detail="El proveïdor d'IA ha rebutjat la clau. Revisa Configuració › IA.",
            ) from e
        raise HTTPException(
            status_code=502,
            detail=safe_error_detail(e, context="POST /ai/correct"),
        )

    return {"corrected": (content or "").strip(), "provider": provider}