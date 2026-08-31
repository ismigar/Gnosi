#!/usr/bin/env python3
"""Generate localized mirrors of the engineering documentation."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING, NotRequired, Protocol, TypedDict, cast

if TYPE_CHECKING:
    from torch import LongTensor, Tensor
    from transformers.generation.utils import GenerateOutput

    class _MarianGenerator(Protocol):
        """The batch-generation call supported by Marian's GenerationMixin."""

        def generate(
            self, *, max_length: int, num_beams: int, **inputs: Tensor,
        ) -> GenerateOutput | LongTensor: ...

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from pipeline.skills.technical_documentation.scripts.generated_localization import (
    localize_generated_reference,
)


class LocaleConfig(TypedDict):
    """Separate filesystem paths from optional reviewed-prose model settings."""

    docs_root: Path
    config: Path
    site_name: str
    site_description: str
    model: NotRequired[str]
    target_prefix: NotRequired[str]


APP_ROOT = Path(__file__).resolve().parents[4]
SOURCE_ROOT = APP_ROOT / "docs" / "engineering"
LOCALES: dict[str, LocaleConfig] = {
    "ca": {
        "docs_root": APP_ROOT / "docs" / "engineering-ca",
        "config": APP_ROOT / "mkdocs-ca.yml",
        "site_name": "Documentació d'enginyeria de Gnosi",
        "site_description": "Arquitectura, implementació, operacions i referència del codi font de Gnosi",
    },
    "es": {
        "docs_root": APP_ROOT / "docs" / "engineering-es",
        "config": APP_ROOT / "mkdocs-es.yml",
        "site_name": "Documentación de ingeniería de Gnosi",
        "site_description": "Arquitectura, implementación, operaciones y referencia del código fuente de Gnosi",
    },
    "fr": {
        "docs_root": APP_ROOT / "docs" / "engineering-fr",
        "config": APP_ROOT / "mkdocs-fr.yml",
        "site_name": "Documentation d'ingénierie de Gnosi",
        "site_description": "Architecture, implémentation, opérations et référence du code source de Gnosi",
        "model": "Helsinki-NLP/opus-mt-en-ROMANCE",
        "target_prefix": ">>fr<<",
    },
}
NAV_LABELS = {
    "ca": {
        "Start here": "Comenceu aquí", "Product": "Producte",
        "Purpose and scope": "Objectiu i abast", "Terminology": "Terminologia",
        "Architecture": "Arquitectura", "System context": "Context del sistema",
        "Runtime and deployment": "Execució i desplegament", "Data and storage": "Dades i emmagatzematge",
        "Cross-cutting flows": "Fluxos transversals", "Domains": "Dominis",
        "Platform foundation and runtime": "Base de la plataforma i execució", "Vault and files": "Vault i fitxers",
        "Database views and planning": "Vistes de base de dades i planificació", "Knowledge graph": "Graf de coneixement",
        "Reader, references, and citations": "Lector, referències i citacions", "Grounded notebooks": "Quaderns fonamentats",
        "AI agents, models, tools, and skills": "Agents, models, eines i habilitats d’IA",
        "Mail": "Correu", "Calendar and meetings": "Calendari i reunions", "Contacts": "Contactes",
        "Social publishing and media": "Publicació social i multimèdia", "Integrations and plugins": "Integracions i connectors",
        "Authentication, workspaces, and sharing": "Autenticació, espais de treball i compartició", "Automation and scheduling": "Automatització i programació",
        "Desktop and companion clients": "Clients d’escriptori i complementaris", "Security": "Seguretat",
        "Trust model": "Model de confiança", "Operations": "Operacions", "Runbook": "Manual d’operacions",
        "Quality": "Qualitat", "Test strategy": "Estratègia de proves", "Documentation maintenance": "Manteniment de la documentació",
        "Decisions": "Decisions", "Decision records": "Registres de decisions", "Local-first source of truth": "Font de veritat local-first",
        "Documentation as code": "Documentació com a codi", "Generated reference": "Referència generada",
        "Repository inventory": "Inventari del repositori", "API catalog": "Catàleg de l’API", "Backend modules": "Mòduls del backend",
        "Frontend catalog": "Catàleg del frontend", "Relational data model": "Model de dades relacional", "Configuration": "Configuració",
        "Tests": "Proves", "Runtime skills": "Habilitats d’execució", "Coverage": "Cobertura",
    },
    "es": {
        "Start here": "Empieza aquí", "Product": "Producto", "Purpose and scope": "Objetivo y alcance",
        "Terminology": "Terminología", "Architecture": "Arquitectura", "System context": "Contexto del sistema",
        "Runtime and deployment": "Ejecución y despliegue", "Data and storage": "Datos y almacenamiento",
        "Cross-cutting flows": "Flujos transversales", "Domains": "Dominios", "Platform foundation and runtime": "Base de la plataforma y ejecución",
        "Vault and files": "Vault y archivos", "Database views and planning": "Vistas de base de datos y planificación",
        "Knowledge graph": "Grafo de conocimiento", "Reader, references, and citations": "Lector, referencias y citas",
        "Grounded notebooks": "Cuadernos fundamentados",
        "AI agents, models, tools, and skills": "Agentes, modelos, herramientas y habilidades de IA", "Mail": "Correo",
        "Calendar and meetings": "Calendario y reuniones", "Contacts": "Contactos", "Social publishing and media": "Publicación social y multimedia",
        "Integrations and plugins": "Integraciones y conectores", "Authentication, workspaces, and sharing": "Autenticación, espacios de trabajo y uso compartido",
        "Automation and scheduling": "Automatización y programación", "Desktop and companion clients": "Clientes de escritorio y complementarios",
        "Security": "Seguridad", "Trust model": "Modelo de confianza", "Operations": "Operaciones", "Runbook": "Manual de operaciones",
        "Quality": "Calidad", "Test strategy": "Estrategia de pruebas", "Documentation maintenance": "Mantenimiento de la documentación",
        "Decisions": "Decisiones", "Decision records": "Registros de decisiones", "Local-first source of truth": "Fuente de verdad local-first",
        "Documentation as code": "Documentación como código", "Generated reference": "Referencia generada",
        "Repository inventory": "Inventario del repositorio", "API catalog": "Catálogo de la API", "Backend modules": "Módulos del backend",
        "Frontend catalog": "Catálogo del frontend", "Relational data model": "Modelo de datos relacional", "Configuration": "Configuración",
        "Tests": "Pruebas", "Runtime skills": "Habilidades de ejecución", "Coverage": "Cobertura",
    },
    "fr": {
        "Start here": "Démarrer ici", "Product": "Produit", "Purpose and scope": "Objectif et périmètre",
        "Terminology": "Terminologie", "Architecture": "Architecture", "System context": "Contexte du système",
        "Runtime and deployment": "Exécution et déploiement", "Data and storage": "Données et stockage",
        "Cross-cutting flows": "Flux transversaux", "Domains": "Domaines", "Platform foundation and runtime": "Fondations de la plateforme et exécution",
        "Vault and files": "Vault et fichiers", "Database views and planning": "Vues de base de données et planification",
        "Knowledge graph": "Graphe de connaissances", "Reader, references, and citations": "Lecteur, références et citations",
        "Grounded notebooks": "Carnets fondés sur les sources",
        "AI agents, models, tools, and skills": "Agents, modèles, outils et compétences d'IA", "Mail": "Courrier",
        "Calendar and meetings": "Calendrier et réunions", "Contacts": "Contacts", "Social publishing and media": "Publication sociale et médias",
        "Integrations and plugins": "Intégrations et extensions", "Authentication, workspaces, and sharing": "Authentification, espaces de travail et partage",
        "Automation and scheduling": "Automatisation et planification", "Desktop and companion clients": "Clients de bureau et complémentaires",
        "Security": "Sécurité", "Trust model": "Modèle de confiance", "Operations": "Opérations", "Runbook": "Guide d'exploitation",
        "Quality": "Qualité", "Test strategy": "Stratégie de test", "Documentation maintenance": "Maintenance de la documentation",
        "Decisions": "Décisions", "Decision records": "Registres de décision", "Local-first source of truth": "Source de vérité local-first",
        "Documentation as code": "Documentation comme code", "Generated reference": "Référence générée",
        "Repository inventory": "Inventaire du dépôt", "API catalog": "Catalogue de l'API", "Backend modules": "Modules backend",
        "Frontend catalog": "Catalogue frontend", "Relational data model": "Modèle de données relationnel", "Configuration": "Configuration",
        "Tests": "Tests", "Runtime skills": "Compétences d'exécution", "Coverage": "Couverture",
    },
}

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(\w*)")
TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*[:\- ]+(?:\|\s*[:\- ]+)*\|?\s*$")
LINE_PREFIX_RE = re.compile(r"^(\s*(?:#{1,6}\s+|>(?:\s*>)*\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+))(.*)$")
PROTECTED_INLINE_RE = re.compile(
    r"`[^`\n]+`|<!--.*?-->|</?[A-Za-z][^>]*>|!\[[^\]]*\]\([^)]*\)|"
    r"\[\[[^\]]*\]\]|\[@[^\]]*\]|\[[^\]]*\]\([^)]*\)|https?://\S+"
)
LINK_RE = re.compile(r"^\[([^\]]*)\]\(([^)]*)\)$")
MERMAID_LABEL_RE = re.compile(r'([\[({]\s*["\'])([^"\']+)(["\']\s*[\])}])')
WORD_RE = re.compile(r"[A-Za-z]{2,}")
MARKUP_SPLIT_RE = re.compile(r"(\*\*|__|~~|(?<!\*)\*(?!\*)|(?<!_)_(?!_))")
PLACEHOLDER_RE = re.compile(r"\uE000(\d{7})\uE001")


class OfflineTranslator:
    """Translate batches locally with cached Marian models."""

    def __init__(self, target: str) -> None:
        self.target = target
        from transformers import MarianMTModel, MarianTokenizer

        locale = LOCALES[target]
        model_name = locale.get("model", f"Helsinki-NLP/opus-mt-en-{target}")
        self.target_prefix = locale.get("target_prefix", "")
        self.tokenizer = MarianTokenizer.from_pretrained(model_name, local_files_only=True)
        self.model = MarianMTModel.from_pretrained(model_name, local_files_only=True)

    def translate(self, texts: list[str], batch_size: int = 32) -> list[str]:
        """Translate plain-language fragments without Markdown tokens."""
        import torch

        results: list[str] = []
        for offset in range(0, len(texts), batch_size):
            batch = texts[offset : offset + batch_size]
            if self.target_prefix:
                batch = [f"{self.target_prefix} {text}" for text in batch]
            inputs = self.tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=512)
            with torch.no_grad():
                # Transformers' internal mixin self protocol is broader than
                # Marian's declared attributes. Keep its bound-method dispatch
                # and exact return union while typing only the call we use.
                outputs = cast("_MarianGenerator", self.model).generate(
                    **inputs, max_length=512, num_beams=1,
                )
            results.extend(self.tokenizer.batch_decode(outputs, skip_special_tokens=True))
        return results


class FragmentCollector:
    """Build a Markdown skeleton and collect only prose for batch translation."""

    def __init__(self) -> None:
        self.fragments: list[str] = []

    def add(self, text: str) -> str:
        leading = text[: len(text) - len(text.lstrip())]
        trailing = text[len(text.rstrip()) :]
        core = text.strip()
        if not core or not WORD_RE.search(core):
            return text
        marker = f"\uE000{len(self.fragments):07d}\uE001"
        self.fragments.append(core)
        return leading + marker + trailing

    def inline(self, text: str) -> str:
        """Collect visible prose while preserving links, code, HTML, and emphasis."""
        output: list[str] = []
        cursor = 0
        for match in PROTECTED_INLINE_RE.finditer(text):
            output.append(self._plain(text[cursor : match.start()]))
            value = match.group(0)
            link = LINK_RE.match(value)
            if link and not value.startswith("!"):
                output.append(f"[{self._plain(link.group(1))}]({link.group(2)})")
            else:
                output.append(value)
            cursor = match.end()
        output.append(self._plain(text[cursor:]))
        return "".join(output)

    def _plain(self, text: str) -> str:
        return "".join(part if MARKUP_SPLIT_RE.fullmatch(part) else self.add(part) for part in MARKUP_SPLIT_RE.split(text))

    def resolve(self, skeleton: str, translations: list[str]) -> str:
        """Reinsert translated fragments without allowing the model to touch syntax."""
        return PLACEHOLDER_RE.sub(lambda match: translations[int(match.group(1))], skeleton)


def split_front_matter(markdown: str) -> tuple[str, str]:
    """Keep YAML metadata unchanged."""
    if not markdown.startswith("---\n"):
        return "", markdown
    closing = markdown.find("\n---\n", 4)
    return ("", markdown) if closing == -1 else (markdown[: closing + 5], markdown[closing + 5 :])


def collect_markdown(markdown: str, collector: FragmentCollector) -> str:
    """Return a structural skeleton and collect translatable fragments."""
    lines = markdown.split("\n")
    output: list[str] = []
    fence_char = ""
    fence_language = ""
    index = 0
    while index < len(lines):
        line = lines[index]
        fence = FENCE_RE.match(line)
        if fence:
            if not fence_char:
                fence_char = fence.group(1)[0]
                fence_language = fence.group(2).lower()
            elif line.strip().startswith(fence_char * 3):
                fence_char = ""
                fence_language = ""
            output.append(line)
            index += 1
            continue
        if fence_char:
            if fence_language == "mermaid":
                line = MERMAID_LABEL_RE.sub(lambda m: m.group(1) + collector.add(m.group(2)) + m.group(3), line)
            output.append(line)
            index += 1
            continue
        stripped = line.strip()
        if not stripped or TABLE_SEPARATOR_RE.match(line) or stripped.startswith("<!--"):
            output.append(line)
            index += 1
            continue
        if stripped.startswith("|"):
            cells = line.split("|")
            output.append("|".join(collector.inline(cell) for cell in cells))
            index += 1
            continue
        marker = LINE_PREFIX_RE.match(line)
        if marker:
            output.append(marker.group(1) + collector.inline(marker.group(2)))
            index += 1
            continue

        # Reflow only ordinary prose paragraphs. Translation quality is materially
        # better with full-sentence context, while blank lines still delimit Markdown.
        paragraph = [stripped]
        index += 1
        while index < len(lines):
            candidate = lines[index]
            candidate_stripped = candidate.strip()
            if (
                not candidate_stripped
                or FENCE_RE.match(candidate)
                or TABLE_SEPARATOR_RE.match(candidate)
                or candidate_stripped.startswith(("|", "<!--"))
                or LINE_PREFIX_RE.match(candidate)
            ):
                break
            paragraph.append(candidate_stripped)
            index += 1
        output.append(collector.inline(" ".join(paragraph)))
    return "\n".join(output)


def translate_markdown_text(markdown: str, translator: OfflineTranslator) -> str:
    """Translate Markdown without exposing structural syntax to the model."""
    front_matter, body = split_front_matter(markdown)
    collector = FragmentCollector()
    skeleton = collect_markdown(body, collector)
    translated = translator.translate(collector.fragments) if collector.fragments else []
    return front_matter + collector.resolve(skeleton, translated)


def write_locale_config(target: str) -> None:
    """Create a deterministic locale-specific MkDocs configuration."""
    locale = LOCALES[target]
    config = (APP_ROOT / "mkdocs.yml").read_text(encoding="utf-8")
    replacements = {
        "site_name: Gnosi Engineering Documentation": f"site_name: {locale['site_name']}",
        "site_description: Architecture, implementation, operations, and source reference for Gnosi": (
            f"site_description: {locale['site_description']}"
        ),
        "site_url: https://gnosi.temenosismael.org/engineering/": f"site_url: https://gnosi.temenosismael.org/engineering/{target}/",
        "docs_dir: docs/engineering": f"docs_dir: docs/engineering-{target}",
        "site_dir: site/engineering": f"site_dir: site/engineering/{target}",
        "  language: en": f"  language: {target}",
    }
    for source, replacement in replacements.items():
        config = config.replace(source, replacement, 1)
    for source, translated in NAV_LABELS[target].items():
        config = re.sub(rf"(^\s*-\s+){re.escape(source)}(:)", rf"\1{translated}\2", config, flags=re.MULTILINE)
    locale["config"].write_text(config, encoding="utf-8")


def generate_locale(
    target: str,
    reviewed_only: bool = False,
    generated_only: bool = False,
    selected_paths: set[Path] | None = None,
) -> None:
    """Generate all localized pages and copy static assets."""
    destination = LOCALES[target]["docs_root"]
    selected_paths = selected_paths or set()
    partial = reviewed_only or generated_only or bool(selected_paths)
    if destination.exists() and not partial:
        shutil.rmtree(destination)
    translator: OfflineTranslator | None = None
    scan_root = SOURCE_ROOT / "generated" if generated_only else SOURCE_ROOT
    for source in sorted(scan_root.rglob("*")):
        relative = source.relative_to(SOURCE_ROOT)
        if selected_paths and relative not in selected_paths:
            continue
        if reviewed_only and relative.parts[0] == "generated":
            continue
        if generated_only and relative.parts[0] != "generated":
            continue
        output = destination / relative
        if source.is_dir():
            output.mkdir(parents=True, exist_ok=True)
        elif relative.parts[0] == "generated":
            expected = localize_generated_reference(
                source.read_bytes(), target, relative.relative_to("generated").as_posix(),
            )
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.is_file() or output.read_bytes() != expected:
                output.write_bytes(expected)
        elif source.suffix == ".md":
            if translator is None:
                translator = OfflineTranslator(target)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(translate_markdown_text(source.read_text(encoding="utf-8"), translator), encoding="utf-8")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, output)
    if not generated_only:
        write_locale_config(target)


def check_locale(
    target: str,
    reviewed_only: bool = False,
    generated_only: bool = False,
    selected_paths: set[Path] | None = None,
) -> list[str]:
    """Check exact generated bytes and reviewed-page presence without writing."""
    destination = LOCALES[target]["docs_root"]
    failures: list[str] = []
    scan_root = SOURCE_ROOT / "generated" if generated_only else SOURCE_ROOT
    for source in sorted(scan_root.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(SOURCE_ROOT)
        if selected_paths and relative not in selected_paths:
            continue
        if reviewed_only and relative.parts[0] == "generated":
            continue
        localized = destination / relative
        if not localized.is_file():
            failures.append(f"missing {relative}")
        elif relative.parts[0] == "generated":
            expected = localize_generated_reference(
                source.read_bytes(), target, relative.relative_to("generated").as_posix(),
            )
            if localized.read_bytes() != expected:
                failures.append(f"stale generated reference {relative}")
        elif localized.suffix == ".md":
            content = localized.read_text(encoding="utf-8")
            if "XGNOSI" in content or "\uE000" in content:
                failures.append(f"translation marker in {relative}")
    if not reviewed_only:
        for localized in sorted((destination / "generated").rglob("*")):
            relative = localized.relative_to(destination)
            if selected_paths and relative not in selected_paths:
                continue
            if localized.is_file() and not (SOURCE_ROOT / relative).is_file():
                failures.append(f"unexpected generated reference {relative}")
    if not generated_only and not LOCALES[target]["config"].is_file():
        failures.append(f"missing {LOCALES[target]['config'].name}")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--locale", choices=sorted(LOCALES), action="append")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--reviewed-only", action="store_true")
    parser.add_argument("--generated-only", action="store_true")
    parser.add_argument(
        "--path",
        action="append",
        default=[],
        help="Refresh one repository-relative documentation path; may be repeated.",
    )
    args = parser.parse_args(argv)
    if args.reviewed_only and args.generated_only:
        parser.error("--reviewed-only and --generated-only are mutually exclusive")
    selected_paths: set[Path] = set()
    for value in args.path:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts:
            parser.error(f"--path must stay below {SOURCE_ROOT.name}: {value}")
        if not (SOURCE_ROOT / path).is_file():
            parser.error(f"--path does not identify a source file: {value}")
        selected_paths.add(path)
    targets = args.locale or sorted(LOCALES)
    if args.check:
        failures = {
            target: check_locale(target, args.reviewed_only, args.generated_only, selected_paths)
            for target in targets
        }
        failures = {target: values for target, values in failures.items() if values}
        if failures:
            for target, values in failures.items():
                print(f"ERROR: {target}: {', '.join(values)}", file=sys.stderr)
            return 1
        print(f"INFO: Locale mirrors are complete for {', '.join(targets)}")
        return 0
    for target in targets:
        print(f"INFO: Generating {target} engineering documentation")
        generate_locale(
            target,
            args.reviewed_only,
            args.generated_only,
            selected_paths,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
