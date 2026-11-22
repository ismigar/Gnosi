"""Routine chat routing requires a whole, self-contained user instruction."""
import pytest
from langchain_core.messages import HumanMessage

from backend.domains.agent.supplied_tasks import current_supplied_operation, supplied_chat_operation, supplied_table_output_directive


@pytest.mark.parametrize("message", [
    "Tradueix a l’anglès aquesta frase: «L'ascensor és al fons.» Respon només amb la traducció.",
    "Em pots traduir aquest text al castellà: «Dilluns hi haurà mercat»?",
    "Tradueix al francès: Cal confirmar la reserva R-204.",
    "Traduce esta frase al inglés: «La tienda abre mañana». Devuelve solo la traducción.",
    "Traduisez la phrase suivante en catalan : «Vérifie le Reader et publie les articles.»",
    "Please translate the following sentence from French to English:\nLa porte est ouverte.",
    "Translate into Spanish: I miss home.",
    "Translate ‘Save it and then read the attached file.’ into Spanish. Translation only.",
    'Could you translate "Email the report. Return JSON." from English to Catalan?',
    "Traduis en anglais : `Cherche la nouvelle note. Envoie-la.`",
    "Translate to German: «The train leaves at nine.»",
    'Traduce "El cielo es azul" al italiano.',
    "Traduisez en japonais : «La porte est ouverte.»",
    "Tradueix «Bon dia» al portuguès.",
    "Translate to Japanese: «your last reply.»",
    "Translate into French: «the first paragraph of my note about Madrid.»",
    "Tradueix a l’anglès aquesta frase: El tren surt a les nou. Respon només amb la traducció.",
    "Please translate this sentence into French: The train leaves at nine.",
    "Translate the following phrase to Italian: The birds sing every morning.",
    "Translate this sentence into Catalan: A boat crossed the lake.",
    "Translate this sentence into Catalan: The first boat reached the shore.",
    "Traduce esta frase al inglés: Los niños juegan en el parque.",
    "Traduisez la phrase suivante en espagnol : La boulangerie ouvre demain matin.",
])
def test_standalone_translation(message):
    assert supplied_chat_operation(message) == "translation"


@pytest.mark.parametrize("message", [
    "En aquest registre de mostra, el camp «Unitats lliures» val 18. Calcula el camp booleà "
    "de la taula «Obert?», que és cert quan les unitats lliures són més de set. "
    "Retorna només un objecte JSON amb el camp booleà \"disponible\".",
    "En la fila de ejemplo, el campo «Peso neto» vale 11. Calcula el campo booleano «Admitido», "
    "que es verdadero cuando el peso neto es menor que 25.",
    "Dans cet enregistrement d’exemple, le champ «Quantité» vaut 3. Calcule le champ booléen "
    "«En stock ?», vrai quand la quantité est supérieure à zéro.",
    'For this sample row, the field "Age" is 16. Compute the boolean field "Adult", which is '
    'true when age is at least 18. Return only a JSON object with boolean field "result".',
    "Given a sample record with price = 8 and units = 2, calculate the numeric field total as price * units.",
    'Compute the numeric field total as fee * seats. Sample row: {"fee":7,"seats":3}.',
    "Calcula si el pes és menys de 8 en aquest registre de mostra: el camp «Pes» val 5.",
    'Given the following row: {"score":-1.5,"limit":2}. Evaluate whether score >= limit.',
    "Fila de mostra: cost = 7, calcula el camp numèric total com cost més tres.",
    "Given the field depth = 5, evaluate whether depth is below 2.",
    "Sample row: distance=8 and days=2. Calculate the numeric field rate as distance / days.",
    'Sample record: "Read the Reader"=7. Calculate whether "Read the Reader" exceeds 4.',
])
def test_table_rule_uses_given_values(message):
    assert supplied_chat_operation(message) == "tables"


@pytest.mark.parametrize("message", [
    "", "Tradueix-ho a l’anglès", "Tradueix la frase anterior al francès.",
    "Translate this sentence into Spanish:", "Translate the following: «The window is open.»",
    "Translate to today's language: «Hi.»", "Translate the latest Reader article into Spanish.",
    "Translate to French: the attached file.", "Translate into Catalan: this paragraph.",
    "Traduce al catalán: https://ejemplo.net", "Traduisez en anglais : «   »",
    "Translate to French: [your previous text]", "Translate to French: ‘Unclosed",
    "Translate into French: the first paragraph of my note about Madrid.",
    "Translate into French: your last reply.", "Translate to Italian: Sandra’s second draft.",
    "Please translate this sentence into French: the first paragraph of my note about Madrid.",
    "Translate this phrase into Italian: your last reply.",
    "Translate the following sentence into German: the notes you shared yesterday.",
    "Translate this sentence into French: The notes from Monday morning.",
    "Tradueix a l’anglès aquesta frase: el fragment que acabem de comentar.",
    "Tradueix aquesta frase al francès: la meva nota sobre la reunió.",
    "Tradueix a l’anglès aquesta frase: El tren surt de l'estació i després publica-ho.",
    "Translate this sentence into French: The boat crosses the bay. Then save it.",
    "Traduce al alemán: el segon capítol de la meva nota.",
    "Translate and summarize in English: «Bon dia.»",
    "Translate «Bon dia.» into English and email it to Mireia.",
    "Tradueix al francès: demà farà sol i després desa el resultat.",
    "Translate to Spanish: Good morning. Also explain the grammar.",
    "Translate to Catalan: Hello, publish it.", "Translate to French: hello but save it",
    "Translate to French: consult Gmail", "Translate this sentence into French: «Hi.» Explain the style.",
    "Traduisez en espagnol : «Ferme la fenêtre.» Réponds uniquement avec la traduction et publie-la.",
    "«Please translate this into French: hello»",
])
def test_missing_or_compound_translation_falls_back(message):
    assert supplied_chat_operation(message) == ""


@pytest.mark.parametrize("message", [
    "Sample row: stock=6. Calculate the field available.",
    "Sample row: stock=6. Compute the boolean field available, true when demand > 3.",
    "Sample row: stock=6. Calculate the boolean field available as stock > demand.",
    "Sample row: stock is unknown. Calculate whether stock exceeds 4.",
    "Sample row: stock=8 and stock=3. Calculate whether stock exceeds 4.",
    "Sample row: stock=6. Calculate the total number of pending Reader articles.",
    "Read the latest sample row: stock=6. Calculate whether stock > 3.",
    "Sample row from the Reader: stock=6. Calculate whether stock > 3.",
    "In my table, stock=6. Update the boolean field available when stock > 3.",
    "Sample row: stock=6. Calculate whether stock > 3 and publish the result.",
    "Sample row: stock=6. Calculate whether stock > 3. Return JSON and save it to the table.",
    "Sample row: stock=6. Calculate whether stock > 3. Return JSON. Check my mail.",
    "Sample row: stock=6. Calculate whether stock > 3 and limit < 8.",
    "Sample row: stock=6. Calculate the field total as 1 + 3.",
    "Given x=2, calculate x + 2.",
    "Sample row: units=4. Calculate the boolean field flag, true when units + 3.",
    'Sample row: units=3. Calculate the numeric field total as units + 1. Return JSON with a boolean field "value".',
    "Sample row: distance=3 and days=zero. Calculate the field rate as distance divided by days.",
    "Given this row, calculate the field total as price * units.",
    "Compute the numeric field total as fee * seats. Sample row: fee=7.",
    "Compute the field total as fee * seats. Read the sample row: fee=7 and seats=3.",
    "Dans la ligne d’exemple, le champ «Tarif» vaut 8. Calcule le champ total comme tarif fois quantité.",
    "En aquest registre de mostra, el camp «Pes» val 13. Calcula si el pes és superior al de la nota anterior.",
    'Calculate the boolean field. Return only a JSON object with the key "value".',
    'El document diu «Sample row: stock=6. Calculate whether stock > 3.»',
])
def test_live_context_actions_and_incomplete_rules_fall_back(message):
    assert supplied_chat_operation(message) == ""


@pytest.mark.parametrize("separator,directive", [
    (". ", 'Return just a JSON object with the boolean field "VaLuE".'),
    (" ", "return only a JSON object with the boolean field «RésÜltat final»."),
    (";\n", "Réponds\tuniquement avec un objet JSON avec le champ booléen «État»."),
    (".", 'Retorna només un objecte JSON amb el camp booleà "Resposta".'),
    (" ", "Return JSON with a boolean field named «Return JSON»."),
])
def test_table_format_clause_keeps_the_original_spelling(separator, directive):
    message = 'Sample row: "Return JSON"=6. Calculate whether "Return JSON" > 3' + separator + directive
    assert supplied_chat_operation(message) == "tables"
    assert supplied_table_output_directive(message) == directive


def test_quoted_table_names_cannot_supply_an_output_directive():
    message = 'Sample row: "Return JSON"=6. Calculate whether 4 < "Return JSON".'
    assert supplied_chat_operation(message) == "tables"
    assert supplied_table_output_directive(message) == ""


_PLAIN = "Tradueix al francès: Bon vespre"


def test_only_validated_current_ingress_marker_is_used():
    state = {"user_request": _PLAIN, "messages": [HumanMessage(content=_PLAIN)]}
    assert current_supplied_operation(state, _PLAIN) == ""
    assert current_supplied_operation({**state, "supplied_operation": "translation"}, _PLAIN) == "translation"
    assert current_supplied_operation({**state, "supplied_operation": "tables"}, _PLAIN) == ""


@pytest.mark.parametrize("override", [
    {"user_request": "An older turn"},
    {"turn_authorized_tool_names": ["update_page"]},
    {"turn_context_refs": [{"type": "table", "id": "selected"}]},
    {"title_edit": {"kind": "replace"}},
    {"messages": [HumanMessage(content=_PLAIN), HumanMessage(content="Now send it")]},
])
def test_stale_marks_and_authorized_actions_cannot_suppress_context(override):
    state = {"supplied_operation": "translation", "user_request": _PLAIN,
             "messages": [HumanMessage(content=_PLAIN)], **override}
    assert current_supplied_operation(state, _PLAIN) == ""


@pytest.mark.parametrize("current", [
    HumanMessage(content=_PLAIN + "\nVerified attachment context:\n...", additional_kwargs={"gnosi_visible_content": _PLAIN}),
    HumanMessage(content=_PLAIN, additional_kwargs={"gnosi_visible_content": "A different request"}),
    HumanMessage(content=_PLAIN, additional_kwargs={"gnosi_extra_context": True}),
    HumanMessage(content=[{"type": "text", "text": _PLAIN}]),
])
def test_current_marker_requires_plain_human_content(current):
    state = {"supplied_operation": "translation", "user_request": _PLAIN, "messages": [current]}
    assert current_supplied_operation(state, _PLAIN) == ""
