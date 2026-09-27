"""Portable, original example notes for the official multilingual catalog."""

from __future__ import annotations

import uuid

LANGUAGES = ["ca", "en", "es", "fr"]


def note(template_id: str, title: str, body: str) -> str:
    identifier = uuid.uuid5(uuid.NAMESPACE_URL, f"gnosi:template:{template_id}:{title}")
    return f"---\nid: {identifier}\n---\n\n# {title}\n\n{body.strip()}\n"


def french_research_notes() -> dict[str, str]:
    notes = {
        "Commencez ici": """Cet espace présente un parcours complet sans IA ni compte externe.

1. Ouvrez [[Gnosi research workflow]] dans la table **Sources**.
2. Lisez [[Note de lecture - Chaîne de preuve]] et revenez à la source.
3. Reliez vos observations dans [[Synthèse - Recherche sans duplication]].
4. Ouvrez [[Manuscrit - Premier paragraphe]] et insérez `gnosi2026` avec le sélecteur de citations (Cmd/Ctrl+Maj+I).
5. Remplacez cette source de démonstration par vos propres références.

Autres langues : [[Start here]] · [[Comença aquí]] · [[Empieza aquí]]""",
        "Note de lecture - Chaîne de preuve": """> A trustworthy knowledge workflow keeps every synthesis connected to the evidence that supports it while leaving the underlying files portable.

— [[Gnosi research workflow]] [@gnosi2026]

**Observation :** la portabilité ne suffit pas ; il faut aussi conserver la provenance des idées. Cette citation est un exemple, pas une source de recherche réelle.""",
        "Synthèse - Recherche sans duplication": """Les formats ouverts préservent la maîtrise des fichiers ; les preuves reliées préservent la confiance. Un espace de recherche utile réunit les deux [[Note de lecture - Chaîne de preuve]] [@gnosi2026].

**À approfondir :** quelles preuves pourraient contredire cette interprétation ?""",
        "Manuscrit - Premier paragraphe": """Un travail de recherche autonome doit préserver les fichiers ouverts et le chemin qui relie l'interprétation aux preuves [@gnosi2026].

Vérifiez la référence et remplacez ce paragraphe d'exemple avant toute diffusion.""",
    }
    return {f"Wiki/{title}.md": note("starter-vault", title, body) for title, body in notes.items()}


# Each locale is self-contained, with working wiki links and reusable checklists.
STUDY_NOTES = {
    "ca": [
        ("Estudi - Comença aquí", "Organitza una assignatura sense serveis externs.\n\n1. Defineix un objectiu a [[Estudi - Pla setmanal]].\n2. Resumeix un tema a [[Estudi - Fitxa de concepte]].\n3. Comprova què recordes a [[Estudi - Repàs actiu]].\n\nExemple: explicar un concepte amb paraules pròpies i resoldre un exercici nou. Substitueix els exemples pels teus temes."),
        ("Estudi - Pla setmanal", "## Objectiu\nExplicar el tema amb un exemple propi.\n\n## Sessions\n- [ ] Dilluns: lectura i tres preguntes.\n- [ ] Dimecres: completar [[Estudi - Fitxa de concepte]].\n- [ ] Divendres: [[Estudi - Repàs actiu]] sense consultar les notes.\n\n## Revisió\nQuè puc explicar? Què em costa? Quin és el següent pas?"),
        ("Estudi - Fitxa de concepte", "## Concepte\nNom i definició amb paraules pròpies.\n\n## Exemple\nDescriu un cas i un contraexemple.\n\n## Font\nAutor, títol i pàgina o enllaç. Separa la citació literal de la interpretació.\n\n## Preguntes\n- Com es relaciona amb el tema anterior?\n- Quan no s'aplica?\n\nContinua a [[Estudi - Repàs actiu]]."),
        ("Estudi - Repàs actiu", "Tanca les notes abans de respondre.\n\n1. Explica el concepte en tres frases.\n2. Resol un exemple diferent.\n3. Escriu què no recordes.\n\nDesprés compara amb [[Estudi - Fitxa de concepte]].\n\n| Pregunta | Resposta pròpia | Correcció | Proper repàs |\n| --- | --- | --- | --- |\n| Quina és la idea principal? | | | |\n\nAjusta [[Estudi - Pla setmanal]] segons els errors."),
    ],
    "es": [
        ("Estudio - Empieza aquí", "Organiza una asignatura sin servicios externos.\n\n1. Define un objetivo en [[Estudio - Plan semanal]].\n2. Resume un tema en [[Estudio - Ficha de concepto]].\n3. Comprueba qué recuerdas en [[Estudio - Repaso activo]].\n\nEjemplo: explicar un concepto con palabras propias y resolver un ejercicio nuevo. Sustituye los ejemplos por tus temas."),
        ("Estudio - Plan semanal", "## Objetivo\nExplicar el tema con un ejemplo propio.\n\n## Sesiones\n- [ ] Lunes: lectura y tres preguntas.\n- [ ] Miércoles: completar [[Estudio - Ficha de concepto]].\n- [ ] Viernes: [[Estudio - Repaso activo]] sin consultar las notas.\n\n## Revisión\n¿Qué puedo explicar? ¿Qué me cuesta? ¿Cuál es el siguiente paso?"),
        ("Estudio - Ficha de concepto", "## Concepto\nNombre y definición con palabras propias.\n\n## Ejemplo\nDescribe un caso y un contraejemplo.\n\n## Fuente\nAutor, título y página o enlace. Separa la cita literal de la interpretación.\n\n## Preguntas\n- ¿Cómo se relaciona con el tema anterior?\n- ¿Cuándo no se aplica?\n\nContinúa en [[Estudio - Repaso activo]]."),
        ("Estudio - Repaso activo", "Cierra las notas antes de responder.\n\n1. Explica el concepto en tres frases.\n2. Resuelve un ejemplo diferente.\n3. Escribe qué no recuerdas.\n\nDespués compara con [[Estudio - Ficha de concepto]].\n\n| Pregunta | Respuesta propia | Corrección | Próximo repaso |\n| --- | --- | --- | --- |\n| ¿Cuál es la idea principal? | | | |\n\nAjusta [[Estudio - Plan semanal]] según los errores."),
    ],
    "en": [
        ("Study - Start here", "Organize a course without external services.\n\n1. Set a goal in [[Study - Weekly plan]].\n2. Summarize a topic in [[Study - Concept note]].\n3. Check your recall in [[Study - Active recall]].\n\nExample: explain a concept in your own words and solve a new exercise. Replace the examples with your own topics."),
        ("Study - Weekly plan", "## Goal\nExplain the topic using an original example.\n\n## Sessions\n- [ ] Monday: reading and three questions.\n- [ ] Wednesday: complete [[Study - Concept note]].\n- [ ] Friday: [[Study - Active recall]] with your notes closed.\n\n## Review\nWhat can I explain? What is difficult? What is the next step?"),
        ("Study - Concept note", "## Concept\nName and definition in your own words.\n\n## Example\nDescribe a case and a counterexample.\n\n## Source\nAuthor, title and page or link. Separate direct quotations from interpretation.\n\n## Questions\n- How does this relate to the previous topic?\n- When does it not apply?\n\nContinue in [[Study - Active recall]]."),
        ("Study - Active recall", "Close your notes before answering.\n\n1. Explain the concept in three sentences.\n2. Solve a different example.\n3. Write down what you cannot recall.\n\nThen compare with [[Study - Concept note]].\n\n| Question | Own answer | Correction | Next review |\n| --- | --- | --- | --- |\n| What is the main idea? | | | |\n\nAdjust [[Study - Weekly plan]] based on your mistakes."),
    ],
    "fr": [
        ("Études - Commencez ici", "Organisez un cours sans services externes.\n\n1. Fixez un objectif dans [[Études - Plan hebdomadaire]].\n2. Résumez un sujet dans [[Études - Fiche de concept]].\n3. Vérifiez vos acquis dans [[Études - Rappel actif]].\n\nExemple : expliquer un concept avec vos mots et résoudre un exercice inédit. Remplacez les exemples par vos propres sujets."),
        ("Études - Plan hebdomadaire", "## Objectif\nExpliquer le sujet avec un exemple personnel.\n\n## Séances\n- [ ] Lundi : lecture et trois questions.\n- [ ] Mercredi : compléter [[Études - Fiche de concept]].\n- [ ] Vendredi : [[Études - Rappel actif]] sans consulter les notes.\n\n## Bilan\nQue puis-je expliquer ? Que dois-je approfondir ? Quelle est la prochaine étape ?"),
        ("Études - Fiche de concept", "## Concept\nNom et définition avec vos propres mots.\n\n## Exemple\nDécrivez un cas et un contre-exemple.\n\n## Source\nAuteur, titre et page ou lien. Séparez les citations de votre interprétation.\n\n## Questions\n- Quel lien avec le sujet précédent ?\n- Quand ce concept ne s'applique-t-il pas ?\n\nContinuez dans [[Études - Rappel actif]]."),
        ("Études - Rappel actif", "Fermez les notes avant de répondre.\n\n1. Expliquez le concept en trois phrases.\n2. Résolvez un autre exemple.\n3. Notez ce qui vous échappe.\n\nComparez ensuite avec [[Études - Fiche de concept]].\n\n| Question | Réponse personnelle | Correction | Prochaine révision |\n| --- | --- | --- | --- |\n| Quelle est l'idée principale ? | | | |\n\nAdaptez [[Études - Plan hebdomadaire]] selon vos erreurs."),
    ],
}

PROJECT_NOTES = {
    "ca": [
        ("Projecte - Comença aquí", "Converteix una idea en passos revisables.\n\n1. Acorda l'abast a [[Projecte - Fitxa]].\n2. Planifica [[Projecte - Tasques]].\n3. Conserva el perquè de cada canvi a [[Projecte - Decisions]].\n\nExemple: preparar una sessió de lectura. Canvia'l pel teu projecte. Aquest espai no envia notificacions ni crea calendaris automàticament."),
        ("Projecte - Fitxa", "## Resultat esperat\nUna sessió de lectura amb una guia de debat compartida.\n\n## Abast\nInclou seleccionar un text, preparar preguntes i revisar la guia.\n\n## Criteri de finalització\n- [ ] Text seleccionat.\n- [ ] Tres preguntes obertes.\n- [ ] Guia revisada per una altra persona.\n\n## Riscos\nTemps de lectura limitat: triar un fragment curt.\n\nContinua a [[Projecte - Tasques]]."),
        ("Projecte - Tasques", "| Tasca | Responsable | Data prevista | Estat |\n| --- | --- | --- | --- |\n| Seleccionar un text | Per assignar | Per acordar | Pendent |\n| Preparar preguntes | Per assignar | Per acordar | Pendent |\n| Revisar la guia | Per assignar | Per acordar | Pendent |\n\n## Revisió setmanal\nQuè s'ha completat? Què està bloquejat? Quina tasca ve després?\n\nRegistra els canvis d'abast a [[Projecte - Decisions]]."),
        ("Projecte - Decisions", "## Registre\n- Data:\n- Decisió:\n- Alternatives considerades:\n- Motiu i evidència:\n- Responsable:\n- Quan revisar-la:\n\nExemple: triar un fragment curt per ajustar-se al temps disponible. Revisa el criteri de finalització de [[Projecte - Fitxa]] quan canviï l'abast."),
    ],
    "es": [
        ("Proyecto - Empieza aquí", "Convierte una idea en pasos revisables.\n\n1. Acuerda el alcance en [[Proyecto - Ficha]].\n2. Planifica [[Proyecto - Tareas]].\n3. Conserva el motivo de cada cambio en [[Proyecto - Decisiones]].\n\nEjemplo: preparar una sesión de lectura. Sustitúyelo por tu proyecto. Este espacio no envía notificaciones ni crea calendarios automáticamente."),
        ("Proyecto - Ficha", "## Resultado esperado\nUna sesión de lectura con una guía de debate compartida.\n\n## Alcance\nSeleccionar un texto, preparar preguntas y revisar la guía.\n\n## Criterio de finalización\n- [ ] Texto seleccionado.\n- [ ] Tres preguntas abiertas.\n- [ ] Guía revisada por otra persona.\n\n## Riesgos\nTiempo de lectura limitado: elegir un fragmento corto.\n\nContinúa en [[Proyecto - Tareas]]."),
        ("Proyecto - Tareas", "| Tarea | Responsable | Fecha prevista | Estado |\n| --- | --- | --- | --- |\n| Seleccionar un texto | Por asignar | Por acordar | Pendiente |\n| Preparar preguntas | Por asignar | Por acordar | Pendiente |\n| Revisar la guía | Por asignar | Por acordar | Pendiente |\n\n## Revisión semanal\n¿Qué se ha completado? ¿Qué está bloqueado? ¿Qué tarea sigue?\n\nRegistra los cambios de alcance en [[Proyecto - Decisiones]]."),
        ("Proyecto - Decisiones", "## Registro\n- Fecha:\n- Decisión:\n- Alternativas consideradas:\n- Motivo y evidencia:\n- Responsable:\n- Cuándo revisarla:\n\nEjemplo: elegir un fragmento corto para ajustarse al tiempo disponible. Revisa el criterio de finalización de [[Proyecto - Ficha]] cuando cambie el alcance."),
    ],
    "en": [
        ("Project - Start here", "Turn an idea into reviewable steps.\n\n1. Agree on the scope in [[Project - Brief]].\n2. Plan [[Project - Tasks]].\n3. Keep the reason for each change in [[Project - Decisions]].\n\nExample: prepare a reading session. Replace it with your project. This workspace does not send notifications or create calendar entries automatically."),
        ("Project - Brief", "## Expected outcome\nA reading session with a shared discussion guide.\n\n## Scope\nSelect a text, prepare questions and review the guide.\n\n## Completion criteria\n- [ ] Text selected.\n- [ ] Three open questions.\n- [ ] Guide reviewed by another person.\n\n## Risks\nLimited reading time: choose a short excerpt.\n\nContinue in [[Project - Tasks]]."),
        ("Project - Tasks", "| Task | Owner | Target date | Status |\n| --- | --- | --- | --- |\n| Select a text | To assign | To agree | Pending |\n| Prepare questions | To assign | To agree | Pending |\n| Review the guide | To assign | To agree | Pending |\n\n## Weekly review\nWhat is complete? What is blocked? What comes next?\n\nRecord scope changes in [[Project - Decisions]]."),
        ("Project - Decisions", "## Record\n- Date:\n- Decision:\n- Alternatives considered:\n- Reason and evidence:\n- Owner:\n- Review date:\n\nExample: choose a short excerpt to fit the available time. Review the completion criteria in [[Project - Brief]] whenever the scope changes."),
    ],
    "fr": [
        ("Projet - Commencez ici", "Transformez une idée en étapes vérifiables.\n\n1. Définissez le périmètre dans [[Projet - Fiche]].\n2. Planifiez [[Projet - Tâches]].\n3. Conservez les raisons de chaque changement dans [[Projet - Décisions]].\n\nExemple : préparer une séance de lecture. Remplacez-le par votre projet. Cet espace n'envoie pas de notifications et ne crée pas automatiquement d'événements."),
        ("Projet - Fiche", "## Résultat attendu\nUne séance de lecture avec un guide de discussion partagé.\n\n## Périmètre\nChoisir un texte, préparer les questions et relire le guide.\n\n## Critères de réussite\n- [ ] Texte choisi.\n- [ ] Trois questions ouvertes.\n- [ ] Guide relu par une autre personne.\n\n## Risques\nTemps de lecture limité : choisir un extrait court.\n\nContinuez dans [[Projet - Tâches]]."),
        ("Projet - Tâches", "| Tâche | Responsable | Date prévue | État |\n| --- | --- | --- | --- |\n| Choisir un texte | À désigner | À convenir | En attente |\n| Préparer les questions | À désigner | À convenir | En attente |\n| Relire le guide | À désigner | À convenir | En attente |\n\n## Bilan hebdomadaire\nQu'est-ce qui est terminé ? Bloqué ? Quelle est la prochaine étape ?\n\nConsignez les changements de périmètre dans [[Projet - Décisions]]."),
        ("Projet - Décisions", "## Registre\n- Date :\n- Décision :\n- Alternatives envisagées :\n- Motif et preuves :\n- Responsable :\n- Date de révision :\n\nExemple : choisir un extrait court adapté au temps disponible. Revoyez les critères de réussite de [[Projet - Fiche]] quand le périmètre change."),
    ],
}


def additional_templates() -> list[tuple[dict[str, object], dict[str, str]]]:
    result = []
    for template_id, name, description, category, notes in (
        ("study-workspace", "Study Workspace", "Course planning, concept notes and active recall in four languages.", "study", STUDY_NOTES),
        ("project-workspace", "Project Workspace", "Project briefs, task tracking and a decision log in four languages.", "projects", PROJECT_NOTES),
    ):
        payloads = {}
        for locale in LANGUAGES:
            for title, body in notes[locale]:
                payloads[f"Wiki/{title}.md"] = note(template_id, title, body)
        result.append(({
            "id": template_id, "version": "1.0.0", "schemaVersion": 1,
            "name": name, "description": description, "author": "Gnosi",
            "license": "CC-BY-4.0", "minGnosiVersion": "3.1.0",
            "categories": ["starter", category], "languages": LANGUAGES,
            "recommendedPlugins": [], "preview": " · ".join(title for title, _ in notes["en"]),
        }, payloads))
    return result
