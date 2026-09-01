"""Localize generated reference chrome without translating source evidence.

Only known titles, section positions, table headers and fixed bullet labels
belong to this vocabulary. Everything else, including table bodies and
source-derived headings, is opaque. No application or translation imports.
"""

from __future__ import annotations

import re


# Values are Catalan, Spanish and French, in that order.
LOCALE_INDEX = {"ca": 0, "es": 1, "fr": 2}
LABELS = {
    "API catalog": ("Catàleg de l’API", "Catálogo de la API", "Catalogue de l’API"),
    "Backend module catalog": (
        "Catàleg de mòduls del backend", "Catálogo de módulos del backend",
        "Catalogue des modules backend",
    ),
    "Configuration catalog": (
        "Catàleg de configuració", "Catálogo de configuración", "Catalogue de configuration",
    ),
    "Documentation coverage": (
        "Cobertura de la documentació", "Cobertura de la documentación",
        "Couverture de la documentation",
    ),
    "Relational data model": (
        "Model de dades relacional", "Modelo de datos relacional", "Modèle de données relationnel",
    ),
    "Frontend catalog": ("Catàleg del frontend", "Catálogo del frontend", "Catalogue frontend"),
    "Repository inventory": (
        "Inventari del repositori", "Inventario del repositorio", "Inventaire du dépôt",
    ),
    "Runtime skill catalog": (
        "Catàleg d’habilitats d’execució", "Catálogo de habilidades de ejecución",
        "Catalogue des compétences d’exécution",
    ),
    "Test catalog": ("Catàleg de proves", "Catálogo de pruebas", "Catalogue des tests"),
    "Summary": ("Resum", "Resumen", "Résumé"),
    "Router registrations": (
        "Registre d’encaminadors", "Registro de enrutadores", "Enregistrement des routeurs",
    ),
    "Operations": ("Operacions", "Operaciones", "Opérations"),
    "Unregistered modules": (
        "Mòduls no registrats", "Módulos no registrados", "Modules non enregistrés",
    ),
    "Module groups": ("Grups de mòduls", "Grupos de módulos", "Groupes de modules"),
    "Table summary": ("Resum de taules", "Resumen de tablas", "Résumé des tables"),
    "Application routes": (
        "Rutes de l’aplicació", "Rutas de la aplicación", "Routes de l’application",
    ),
    "Source groups": ("Grups de codi font", "Grupos de código fuente", "Groupes de code source"),
    "Key counts": ("Recomptes principals", "Recuentos principales", "Décomptes principaux"),
    "Owned application surfaces": (
        "Àrees pròpies de l’aplicació", "Áreas propias de la aplicación",
        "Périmètres propres à l’application",
    ),
    "Exclusion boundary": ("Límit d’exclusió", "Límite de exclusión", "Périmètre d’exclusion"),
    "Order": ("Ordre", "Orden", "Ordre"),
    "Router": ("Encaminador", "Enrutador", "Routeur"),
    "Mount prefix": ("Prefix de muntatge", "Prefijo de montaje", "Préfixe de montage"),
    "Tags": ("Etiquetes", "Etiquetas", "Étiquettes"),
    "Registration": ("Registre", "Registro", "Enregistrement"),
    "Method": ("Mètode", "Método", "Méthode"),
    "Effective path": ("Ruta efectiva", "Ruta efectiva", "Chemin effectif"),
    "Handler": ("Gestor", "Gestor", "Gestionnaire"),
    "Dependency guards": (
        "Controls de dependències", "Controles de dependencias", "Contrôles des dépendances",
    ),
    "Source": ("Font", "Fuente", "Source"),
    "Group": ("Grup", "Grupo", "Groupe"),
    "Modules": ("Mòduls", "Módulos", "Modules"),
    "Lines": ("Línies", "Líneas", "Lignes"),
    "Module": ("Mòdul", "Módulo", "Module"),
    "Classes": ("Classes", "Clases", "Classes"),
    "Functions": ("Funcions", "Funciones", "Fonctions"),
    "Async": ("Asíncrones", "Asíncronas", "Asynchrones"),
    "Documented declarations": (
        "Declaracions documentades", "Declaraciones documentadas", "Déclarations documentées",
    ),
    "Purpose signal": ("Indici de propòsit", "Indicio de propósito", "Indice de fonction"),
    "Table": ("Taula", "Tabla", "Table"),
    "Model": ("Model", "Modelo", "Modèle"),
    "Columns": ("Columnes", "Columnas", "Colonnes"),
    "Column": ("Columna", "Columna", "Colonne"),
    "Type": ("Tipus", "Tipo", "Type"),
    "Primary key": ("Clau primària", "Clave primaria", "Clé primaire"),
    "Nullable": ("Admet nuls", "Admite nulos", "Accepte les valeurs nulles"),
    "Unique": ("Únic", "Único", "Unique"),
    "Index": ("Índex", "Índice", "Index"),
    "Foreign key": ("Clau forana", "Clave externa", "Clé étrangère"),
    "Source default": (
        "Valor per defecte al codi", "Valor predeterminado en el código", "Valeur par défaut du code",
    ),
    "Browser path": ("Ruta del navegador", "Ruta del navegador", "Chemin du navigateur"),
    "Component": ("Component", "Componente", "Composant"),
    "Files": ("Fitxers", "Archivos", "Fichiers"),
    "Literal API references": (
        "Referències literals a l’API", "Referencias literales a la API",
        "Références littérales à l’API",
    ),
    "Export signals": ("Indicis d’exportació", "Indicios de exportación", "Indices d’exportation"),
    "Literal API paths": (
        "Rutes literals de l’API", "Rutas literales de la API", "Chemins littéraux de l’API",
    ),
    "Variable": ("Variable", "Variable", "Variable"),
    "Runtime": ("Entorn d’execució", "Entorno de ejecución", "Environnement d’exécution"),
    "Consumers": ("Consumidors", "Consumidores", "Consommateurs"),
    "Runner": ("Executor", "Ejecutor", "Exécuteur"),
    "Test signals": ("Indicis de proves", "Indicios de pruebas", "Indices de tests"),
    "File": ("Fitxer", "Archivo", "Fichier"),
    "Counting method": ("Mètode de recompte", "Método de recuento", "Méthode de comptage"),
    "Skill": ("Habilitat", "Habilidad", "Compétence"),
    "Declared title": ("Títol declarat", "Título declarado", "Titre déclaré"),
    "Documentation lines": (
        "Línies de documentació", "Líneas de documentación", "Lignes de documentation",
    ),
    "Scripts": ("Scripts", "Scripts", "Scripts"),
    "Contract": ("Contracte", "Contrato", "Contrat"),
    "Domain": ("Domini", "Dominio", "Domaine"),
    "Status": ("Estat", "Estado", "État"),
    "Guide": ("Guia", "Guía", "Guide"),
    "Source files": ("Fitxers font", "Archivos fuente", "Fichiers source"),
    "Test files": ("Fitxers de proves", "Archivos de pruebas", "Fichiers de test"),
    "Directives found": ("Directives trobades", "Directivas encontradas", "Directives trouvées"),
    "Surface": ("Àrea", "Área", "Périmètre"),
    "Count": ("Recompte", "Recuento", "Décompte"),
    "Purpose boundary": ("Abast funcional", "Alcance funcional", "Périmètre fonctionnel"),
    "Source patterns": ("Patrons de fonts", "Patrones de fuentes", "Motifs des sources"),
    "Test patterns": ("Patrons de proves", "Patrones de pruebas", "Motifs des tests"),
    "Directives": ("Directives", "Directivas", "Directives"),
    "Registered routers": (
        "Encaminadors registrats", "Enrutadores registrados", "Routeurs enregistrés",
    ),
    "Discovered operations": (
        "Operacions descobertes", "Operaciones descubiertas", "Opérations découvertes",
    ),
    "Unregistered route modules": (
        "Mòduls de rutes no registrats", "Módulos de rutas no registrados",
        "Modules de routes non enregistrés",
    ),
    "Regenerate with": ("Regenera amb", "Regenera con", "Régénérer avec"),
}

# Section positions matter: subsequent headings can be source directory names
# or domain titles identical to a fixed label, and must not be translated.
PAGE_LABELS = {
    "api-catalog.md": (
        "API catalog", ("Summary", "Router registrations", "Operations", "Unregistered modules"),
    ),
    "backend-modules.md": ("Backend module catalog", ("Module groups",)),
    "configuration.md": ("Configuration catalog", ()),
    "coverage.md": ("Documentation coverage", ()),
    "data-model.md": ("Relational data model", ("Table summary",)),
    "frontend-catalog.md": ("Frontend catalog", ("Application routes", "Source groups")),
    "repository-inventory.md": (
        "Repository inventory", ("Key counts", "Owned application surfaces", "Exclusion boundary"),
    ),
    "skills.md": ("Runtime skill catalog", ()),
    "tests.md": ("Test catalog", ("Summary", "Files")),
}

TABLE_HEADERS = (
    "Order | Router | Mount prefix | Tags | Registration",
    "Method | Effective path | Handler | Tags | Dependency guards | Summary | Source",
    "Group | Modules | Lines",
    "Module | Lines | Classes | Functions | Async | Documented declarations | Purpose signal",
    "Table | Model | Columns | Source",
    "Column | Type | Primary key | Nullable | Unique | Index | Foreign key | Source default | Source",
    "Browser path | Component | Source",
    "Group | Files | Lines | Literal API references",
    "Source | Lines | Export signals | Literal API paths",
    "Variable | Runtime | Source default | Consumers",
    "Runner | Files | Test signals",
    "Runner | File | Test signals | Counting method",
    "Skill | Declared title | Documentation lines | Scripts | Contract",
    "Domain | Status | Guide | Source files | Test files | Directives found",
    "Surface | Count",
    "Surface | Files | Purpose boundary",
)
BULLET_LABELS = {
    "api-catalog.md": (
        "Registered routers", "Discovered operations", "Unregistered route modules",
    ),
    "coverage.md": ("Guide", "Source patterns", "Test patterns", "Directives"),
}
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
SEPARATOR_RE = re.compile(r"\|(?:\s*:?-{3,}:?\s*\|)+")
REGENERATE_RE = re.compile(r"Regenerate with (`[^`]+`)\.")


def _localize_instruction(line: str, language: int, filename: str) -> str:
    """Translate fixed instruction prefixes without inspecting source values."""
    if match := REGENERATE_RE.fullmatch(line):
        return f"{LABELS['Regenerate with'][language]} {match.group(1)}."
    for label in BULLET_LABELS.get(filename, ()):
        prefix = f"- {label}: "
        if line.startswith(prefix):
            return f"- {LABELS[label][language]}: " + line[len(prefix):]
    return line


def localize_generated_reference(content: bytes, target: str, filename: str) -> bytes:
    """Translate known reference labels, preserving all other bytes verbatim.

    Unknown files/assets pass through. Vocabulary changes require regenerating
    locale references; the same function supplies exact expected check bytes.
    """
    language = LOCALE_INDEX[target]
    if filename not in PAGE_LABELS:
        return content
    title, sections = PAGE_LABELS[filename]
    headers = {
        f"| {header} |": "| " + " | ".join(
            LABELS[cell][language] for cell in header.split(" | ")
        ) + " |"
        for header in TABLE_HEADERS
    }
    lines = content.decode("utf-8").splitlines(keepends=True)
    output: list[str] = []
    fence = ""
    front_matter = False
    title_seen = False
    section_index = 0
    in_table = False
    for index, original in enumerate(lines):
        line = original.rstrip("\r\n")
        ending = original[len(line):]
        if index == 0 and line == "---":
            front_matter = True
        elif front_matter and line in {"---", "..."}:
            front_matter = False
            output.append(original)
            continue
        if front_matter:
            output.append(original)
            continue
        marker = FENCE_RE.match(line)
        if fence:
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + r"{" + str(len(fence)) + r",}\s*", line):
                fence = ""
            output.append(original)
            continue
        if marker:
            fence = marker.group(1)
            output.append(original)
            continue
        if line.startswith("|"):
            next_line = lines[index + 1].rstrip("\r\n") if index + 1 < len(lines) else ""
            if not in_table and SEPARATOR_RE.fullmatch(next_line):
                line = headers.get(line, line)
            in_table = True
        else:
            in_table = False
            if line.startswith("# ") and not title_seen:
                title_seen = True
                if line == f"# {title}":
                    line = f"# {LABELS[title][language]}"
            elif line.startswith("## "):
                if section_index < len(sections) and line == f"## {sections[section_index]}":
                    line = f"## {LABELS[sections[section_index]][language]}"
                section_index += 1
            else:
                line = _localize_instruction(line, language, filename)
        output.append(line + ending)
    return "".join(output).encode("utf-8")
