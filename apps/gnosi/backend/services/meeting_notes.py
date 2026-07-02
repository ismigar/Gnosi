"""Orquestrador del prenedor d'actes amb IA.

Flux d'un job (un en vol): àudio → transcripció LOCAL (faster-whisper) → ACTA amb
IA (`factory.generate_text`) → pàgina del Vault. Degrada amb elegància: si la IA
cau (claus invàlides), desa igualment la pàgina amb la transcripció + un avís.

Estat global d'un sol job estil `audio_summarizer.generation_status` (es consulta
des de `GET /api/meetings/status`).
"""
import asyncio
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Estat del job (un en vol). stage: idle|transcribing|summarizing|saving|done|error
job_status = {
    "running": False,
    "stage": "idle",
    "progress": 0,
    "error": None,
    "page_id": None,
    "title": None,
}
_LOCK = threading.Lock()


def get_status() -> dict:
    return dict(job_status)


def _build_acta_prompt(title: str, transcript: str) -> str:
    return (
        "Ets un assistent que redacta ACTES de reunions. A partir de la "
        "TRANSCRIPCIÓ, redacta una acta clara i estructurada en Markdown, en el "
        "MATEIX idioma de la transcripció. Usa EXACTAMENT aquestes seccions:\n"
        "## Resum\n(2-4 frases)\n\n"
        "## Punts tractats\n(vinyetes)\n\n"
        "## Decisions\n(vinyetes; si no n'hi ha cap, escriu «Cap decisió registrada»)\n\n"
        "## Tasques i acords\n(vinyetes amb responsable i data si es diu: "
        "`- [ ] Tasca — Responsable (data)`)\n\n"
        "## Properes passes\n(vinyetes)\n\n"
        "NO incloguis la transcripció ni res fora d'aquestes seccions.\n\n"
        f"Títol de la reunió: {title}\n\n--- TRANSCRIPCIÓ ---\n{transcript}"
    )


def _acta_page_markdown(acta_md: str, transcript: str, meta_line: str) -> str:
    transcript_block = transcript or "(transcripció buida)"
    return (
        f"{meta_line}\n\n"
        f"{acta_md}\n\n"
        "---\n\n"
        "<details>\n<summary>📝 Transcripció completa</summary>\n\n"
        f"{transcript_block}\n\n</details>\n"
    )


def _create_vault_page(title: str, content: str) -> Optional[str]:
    """Crea una pàgina al Vault reutilitzant `create_page` (via asyncio.run).

    `create_page` és async i normalment corre en context de petició; aquí
    l'invoquem directament des del thread del job amb un event loop nou. Per a
    una pàgina simple (sense taula) no necessita estat de petició: escriu el .md
    a la carpeta WIKI i insereix la pàgina a l'índex en línia.
    """
    from fastapi import BackgroundTasks

    from backend.api.vault_routes import PageSaveRequest, create_page

    req = PageSaveRequest(title=title, content=content, metadata={"icon": "🎙️"})

    async def _run():
        return await create_page(req, BackgroundTasks())

    result = asyncio.run(_run())
    return (result or {}).get("id")


def process_meeting(audio_path: str, title: str, mode: str = "presencial") -> dict:
    """Job complet (pensat per a córrer en un thread de fons)."""
    from backend.services.transcription import transcribe

    safe_title = (title or "").strip() or "Reunió"
    try:
        # 1) Transcripció local
        job_status.update({"stage": "transcribing", "progress": 10, "error": None})
        result = transcribe(audio_path)
        transcript = (result.get("text") or "").strip()
        language = result.get("language")
        duration = result.get("duration", 0) or 0

        # 2) Acta amb IA (degrada si cau)
        job_status.update({"stage": "summarizing", "progress": 60})
        acta_md = ""
        if transcript:
            try:
                from backend.agent.factory import generate_text
                acta_md, _ = generate_text(
                    _build_acta_prompt(safe_title, transcript), user_message=safe_title
                )
                acta_md = (acta_md or "").strip()
            except Exception as e:
                log.info(f"meeting_notes: acta IA no disponible ({e}).")
        if not acta_md:
            acta_md = (
                "> ⚠️ No s'ha pogut generar l'acta amb IA (revisa Configuració › IA). "
                "A sota tens la transcripció completa."
            )

        # 3) Pàgina del Vault
        job_status.update({"stage": "saving", "progress": 85})
        now = datetime.now()
        meta_bits = [
            f"**Data:** {now.strftime('%Y-%m-%d %H:%M')}",
            f"**Modalitat:** {'Online' if mode == 'online' else 'Presencial'}",
        ]
        if duration:
            meta_bits.append(f"**Durada:** ~{int(duration // 60)} min")
        if language:
            meta_bits.append(f"**Idioma:** {language}")
        meta_line = " · ".join(meta_bits)
        page_title = f"Acta — {safe_title} ({now.strftime('%d/%m/%Y')})"
        content = _acta_page_markdown(acta_md, transcript, meta_line)

        page_id = _create_vault_page(page_title, content)
        job_status.update(
            {"running": False, "stage": "done", "progress": 100, "page_id": page_id}
        )
        return {"page_id": page_id, "transcript_chars": len(transcript)}
    except Exception as e:
        log.error(f"meeting_notes: job ha fallat: {e}", exc_info=True)
        job_status.update({"running": False, "stage": "error", "error": str(e)})
        return {"error": str(e)}
    finally:
        # Neteja el fitxer d'àudio temporal (privacitat + espai).
        try:
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
        except Exception:
            pass


def start_async(audio_path: str, title: str, mode: str) -> bool:
    """Llança el job en un thread daemon. Retorna False si ja n'hi ha un en vol."""
    with _LOCK:
        if job_status["running"]:
            return False
        job_status.update({
            "running": True, "stage": "transcribing", "progress": 5,
            "error": None, "page_id": None, "title": (title or "").strip() or "Reunió",
        })
    threading.Thread(
        target=process_meeting, args=(audio_path, title, mode), daemon=True
    ).start()
    return True
