"""Compare protected technical content in reviewed Markdown, without models.

This is not a prose-equivalence or general Markdown validator. It protects
front matter, code spans, fenced examples, diagram structure and link targets;
the existing portal validator and human review remain complementary gates.
"""

from __future__ import annotations

import re
from collections import Counter

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
CODE_RUN = re.compile(r"`+")
LINK_START = re.compile(r"!?\[[^\]\n]*\]\(")
URL = re.compile(r"(?:https?://|mailto:)[^\s<>]+")
DIAGRAM_LABEL = re.compile(r"""([\[({]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*[\])}])""")
STATE_CAPTION = re.compile(r"^(\s*(?:\w+|\[\*\])\s*-->\s*(?:\w+|\[\*\])\s*):.*$", re.MULTILINE)
PARTICIPANT = re.compile(r"^(\s*(?:participant|actor)\s+\w+\s+as\s+).*$", re.MULTILINE)
MESSAGE = re.compile(r"^(\s*\w+\s*[-<>()x+]+\s*[+-]?\w+\s*):.*$", re.MULTILINE)
EDGE_CAPTION = re.compile(r"(-->)\|[^|\n]*\|")


def diagram_structure(example: str) -> str:
    """Mask displayed captions, retaining diagram IDs, arrows and ordering."""
    result = DIAGRAM_LABEL.sub(
        lambda match: match[1] + match[2][0] + "LABEL" + match[2][-1] + match[3],
        example,
    )
    if result.lstrip().startswith("stateDiagram"):
        result = STATE_CAPTION.sub(r"\1:LABEL", result)
    elif result.lstrip().startswith("sequenceDiagram"):
        result = PARTICIPANT.sub(r"\1LABEL", result)
        result = MESSAGE.sub(r"\1:LABEL", result)
    else:
        result = EDGE_CAPTION.sub(r"\1|LABEL|", result)
    return result


def split_metadata(markdown: str) -> tuple[str, str]:
    """Separate the existing portal's exact front-matter representation."""
    if not markdown.startswith("---\n"):
        return "", markdown
    closing = markdown.find("\n---\n", 4)
    if closing < 0:
        raise ValueError("unclosed front matter")
    return markdown[: closing + 5], markdown[closing + 5 :]


def fenced_examples(body: str) -> tuple[str, list[tuple[str, str]]]:
    """Extract fenced content, allowing only displayed Mermaid captions to translate."""
    prose: list[str] = []
    examples: list[tuple[str, str]] = []
    marker = ""
    language = ""
    content: list[str] = []
    for line in body.splitlines():
        opening = FENCE.match(line)
        if not marker:
            if opening:
                marker, language = opening.group(1), opening.group(2).strip()
                content = []
                prose.append("")
            else:
                prose.append(line)
        elif re.fullmatch(rf" {{0,3}}{re.escape(marker[0])}{{{len(marker)},}}\s*", line):
            example = "\n".join(content)
            if language == "mermaid":
                example = diagram_structure(example)
            examples.append((language, example))
            marker = ""
        else:
            content.append(line)
    if marker:
        raise ValueError("unclosed fenced example")
    return "\n".join(prose), examples


def escaped(text: str, offset: int) -> bool:
    """An odd backslash run escapes a Markdown delimiter."""
    prefix = text[:offset]
    return (len(prefix) - len(prefix.rstrip("\\"))) % 2 == 1


def inline_examples(text: str) -> tuple[str, list[str]]:
    """Match equal-length backtick runs and normalize code-span line wrapping."""
    values: list[str] = []
    prose: list[str] = []
    cursor = 0
    for opening in CODE_RUN.finditer(text):
        if opening.start() < cursor or escaped(text, opening.start()):
            continue
        ending = re.search(rf"(?<!`){re.escape(opening.group())}(?!`)", text[opening.end() :])
        if ending is None:
            continue  # An unmatched run is literal Markdown, not a code span.
        end_start = opening.end() + ending.start()
        end = opening.end() + ending.end()
        value = text[opening.end() : end_start].replace("\n", " ")
        if value.startswith(" ") and value.endswith(" ") and value.strip():
            value = value[1:-1]
        values.append(value)
        prose.append(text[cursor : opening.start()])
        prose.append(" " * (end - opening.start()))
        cursor = end
    prose.append(text[cursor:])
    return "".join(prose), values


def link_target(text: str, start: int) -> str:
    """Read a destination, including balanced/escaped parentheses or angles."""
    cursor = start
    if cursor < len(text) and text[cursor] == "<":
        end = text.find(">", cursor + 1)
        return text[cursor + 1 : end] if end >= 0 else text[cursor:]
    depth = 0
    while cursor < len(text):
        char = text[cursor]
        if not escaped(text, cursor):
            if char.isspace() or (char == ")" and depth == 0):
                break
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
        cursor += 1
    return text[start:cursor]


def protected_values(markdown: str) -> dict[str, Counter[str]]:
    """Return deterministic technical inventories, independent of prose order."""
    metadata, body = split_metadata(markdown)
    prose, fences = fenced_examples(body)
    prose, inline = inline_examples(prose)
    # Internal heading fragments are localized by MkDocs; page paths are not.
    targets = [link_target(prose, match.end()) for match in LINK_START.finditer(prose)]
    relative = [target.split("#", 1)[0] for target in targets if not target.startswith("#")]
    urls = [match.group().rstrip(".,;:)]") for match in URL.finditer(prose)]
    return {
        "front matter": Counter([metadata]),
        "inline code": Counter(inline),
        "fenced examples": Counter(
            f"{index}:{language}\n{value}" for index, (language, value) in enumerate(fences)
        ),
        "link targets": Counter(relative),
        "URLs": Counter(urls),
    }


def compare_reviewed(source: str, localized: str) -> list[str]:
    """Report categories of drift without echoing potentially sensitive values."""
    try:
        expected = protected_values(source)
        actual = protected_values(localized)
    except ValueError as error:
        return [str(error)]
    return [category for category, values in expected.items() if actual[category] != values]
