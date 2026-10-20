"""Normalize selected Markdown to a closed publication link namespace.

The parser, rather than regular-expression replacement of the source document,
distinguishes code, HTML, reference links, images and autolinks. No asset bytes or
unselected note bodies enter a bundle. The browser applies the same closed link
policy as a second boundary.
"""

from __future__ import annotations

import posixpath
import re
import string
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt
from markdown_it.rules_block.fence import make_fence_rule
from markdown_it.rules_inline import StateInline
from markdown_it.token import Token
from markdown_it.utils import EnvType

from .schemas import PublicationPage


TEXT_PUNCTUATION = re.compile("([" + re.escape(string.punctuation) + "])")
TEXT_TOKENS = {"text", "text_special"}
INLINE_MARKERS = {
    "em_open": "*",
    "em_close": "*",
    "strong_open": "**",
    "strong_close": "**",
    "s_open": "~~",
    "s_close": "~~",
    "softbreak": "\n",
    "hardbreak": "  \n",
}
BLOCK_GROUPS = {
    "blockquote_open",
    "bullet_list_open",
    "ordered_list_open",
    "list_item_open",
    "table_open",
}


@dataclass(frozen=True)
class SelectedNote:
    id: str
    title: str
    path: str
    aliases: tuple[str, ...]
    body: str


def escape(text: str) -> str:
    """Emit plain text without letting punctuation create new Markdown structure."""
    return TEXT_PUNCTUATION.sub(r"\\\1", text)


def closing_token(tokens: list[Token], start: int) -> int:
    """Find the matching close within this token sequence, including nested spans."""
    depth: int = tokens[start].nesting
    for index in range(start + 1, len(tokens)):
        depth += tokens[index].nesting
        if depth == 0:
            return index
    return len(tokens)


def text_span(tokens: list[Token]) -> tuple[str, set[int]]:
    """Join decoded text while retaining which characters came from escapes."""
    parts: list[str] = []
    protected: set[int] = set()
    offset = 0
    for token in tokens:
        parts.append(token.content)
        if token.type == "text_special" and token.info == "escape":
            protected.update(range(offset, offset + len(token.content)))
        offset += len(token.content)
    return "".join(parts), protected


def literal_wiki_prefix(match: re.Match[str], protected: set[int]) -> bool:
    # The app recognizes wiki syntax in decoded text, but an escaped leading
    # bang or first opening bracket makes the whole reference literal.
    opening = match.start(2) - 2
    return match.start() in protected or opening in protected


def math_inline(state: StateInline, silent: bool) -> bool:
    """Keep dollar-delimited TeX opaque to Markdown's escape and link rules."""
    if state.src[state.pos] != "$":
        return False
    start = state.pos
    end = start + 1
    while end < state.posMax and state.src[end] == "$":
        end += 1
    marker = state.src[start:end]
    for match in re.finditer(r"\$+", state.src[end : state.posMax]):
        if len(match[0]) != len(marker):
            continue
        if not silent:
            token = state.push("math_inline", "math", 0)
            token.markup = marker
            token.content = state.src[end : end + match.start()]
        state.pos = end + match.end()
        return True
    if not silent:
        state.pending += marker
    state.pos = end
    return True


def safe_external(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    path = unquote(parsed.path).lower()
    return (
        parsed.scheme in {"https", "http", "mailto"}
        and (parsed.scheme == "mailto" or bool(parsed.netloc))
        and not parsed.username
        and not parsed.password
        and not re.search(r"[\x00-\x20\\]", url)
        and not re.search(r"/(?:api|@[^/]+|vault|knowledge|assets|files|raw)(?:/|$)", path)
    )


class SnapshotMarkdown:
    def __init__(self, notes: list[SelectedNote], local_prefixes: tuple[str, ...] = ()) -> None:
        self.notes = notes
        self.ids = {note.id: f"p{index + 1}" for index, note in enumerate(notes)}
        self.names: dict[str, set[str]] = {}
        self.paths = {note.path: note.id for note in notes}
        self.local_prefixes = (
            "/vault/page/",
            "/vault/pages/",
            "/api/vault/pages/",
        ) + local_prefixes
        for note in notes:
            for name in (
                note.id,
                note.title,
                note.path,
                note.path.removesuffix(".md"),
                *note.aliases,
            ):
                self.names.setdefault(name.casefold(), set()).add(note.id)
        self.omissions = 0
        self.current = notes[0]
        self.environment: EnvType = {}
        self.parser = MarkdownIt("commonmark", {"html": True}).enable(["table", "strikethrough"])
        # Wiki prefixes must retain source escape provenance until
        # serialization; the default final join discards that distinction.
        self.parser.core.ruler.disable("text_join")
        self.parser.inline.ruler.before("escape", "math_inline", math_inline)
        self.parser.block.ruler.before(
            "fence",
            "math_block",
            make_fence_rule(
                markers=("$",),
                token_type="math_block",
                min_markers=2,
                disallow_marker_in_info=("$",),
            ),
            {"alt": ["paragraph", "reference", "blockquote", "list"]},
        )

    def omit(self, kind: str, *, link_label: bool = False) -> str:
        self.omissions += 1
        # Images are valid label children; links cannot contain another link.
        # The public renderer turns either form into the same omission notice.
        marker = "!" if link_label else ""
        return f"{marker}[omitted](gnosi-omitted:{kind})"

    def target(self, raw: str) -> str | None:
        base, _, fragment = raw.partition("#")
        base = unquote(base)
        # Only explicit known local prefixes can resolve to selected note IDs.
        for prefix in self.local_prefixes:
            if base.startswith(prefix):
                base = base[len(prefix) :]
                break
        if re.match(r"^[a-z][\w+.-]*:", base, re.I) or base.startswith("//"):
            return raw if safe_external(raw) else None
        page_id = self.current.id if not base else None
        if base:
            relative = posixpath.normpath(
                posixpath.join(posixpath.dirname(self.current.path), base)
            )
            page_id = self.paths.get(relative)
            if page_id is None:
                matches = self.names.get(
                    base.removeprefix("./").removesuffix(".md").casefold(), set()
                )
                if len(matches) == 1:
                    page_id = next(iter(matches))
        if page_id is None or page_id not in self.ids:
            return None
        anchor = "#" + quote(unquote(fragment), safe="") if fragment else ""
        return f"gnosi-published:{self.ids[page_id]}{anchor}"

    def text(self, tokens: list[Token], *, literal: bool = False) -> str:
        value, protected = text_span(tokens)
        if literal:
            return escape(value)
        result: list[str] = []
        cursor = 0
        for match in re.finditer(r"(!?)\[\[([^\]\n]+)\]\]", value):
            if literal_wiki_prefix(match, protected):
                continue
            result.append(escape(value[cursor : match.start()]))
            raw, _, alias = match[2].partition("|")
            target = self.target(raw.strip())
            if match[1]:
                # Embeds become ordinary links only when the target is in this
                # exact selection. No nested lookup or network fetch is possible.
                result.append(
                    f"[{escape(alias or raw)}]({target})"
                    if target and target.startswith("gnosi-published:")
                    else self.omit("embed")
                )
            elif target:
                result.append(f"[{escape(alias or raw)}]({target})")
            else:
                result.append(self.omit("link"))
            cursor = match.end()
        result.append(escape(value[cursor:]))
        return "".join(result)

    def inline(
        self, tokens: list[Token], *, table_cell: bool = False, link_label: bool = False
    ) -> str:
        result: list[str] = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.type in TEXT_TOKENS:
                end = index + 1
                while end < len(tokens) and tokens[end].type in TEXT_TOKENS:
                    end += 1
                result.append(self.text(tokens[index:end], literal=link_label))
                index = end - 1
            elif token.type == "link_open":
                end = closing_token(tokens, index)
                result.append(self.link(token, tokens[index + 1 : end], table_cell=table_cell))
                index = end
            else:
                result.append(
                    self.inline_token(token, table_cell=table_cell, link_label=link_label)
                )
            index += 1
        return "".join(result)

    def link(self, token: Token, children: list[Token], *, table_cell: bool) -> str:
        target = self.target(str(token.attrGet("href") or ""))
        if not target:
            return self.omit("link")
        # Inline and reference links share these tokens. Preserve their rich
        # labels without interpreting wiki-looking text as nested navigation.
        label = self.inline(children, table_cell=table_cell, link_label=True)
        # Angle brackets prevent punctuation in a destination from terminating it.
        destination = target.replace("<", "%3C").replace(">", "%3E")
        return f"[{label}](<{destination}>)"

    def inline_token(self, token: Token, *, table_cell: bool, link_label: bool = False) -> str:
        if token.type == "code_inline":
            fence = "`" * (
                max((len(item) for item in re.findall(r"`+", token.content)), default=0) + 1
            )
            content = token.content.replace("|", r"\|") if table_cell else token.content
            return f"{fence} {content} {fence}"
        if token.type == "math_inline":
            value = self.math(token, link_label=link_label)
            return value.replace("|", r"\|") if table_cell else value
        if token.type == "image":
            return self.omit("asset", link_label=link_label)
        if token.type == "html_inline":
            return self.omit("html", link_label=link_label)
        return INLINE_MARKERS.get(token.type, "")

    def math(self, token: Token, *, link_label: bool = False) -> str:
        # KaTeX also runs without trust in the reader. Resource/HTML commands
        # never retain private destinations in the immutable public payload.
        if re.search(r"\\(?:href|url|includegraphics|html[A-Za-z]*)\b|<[/!A-Za-z]", token.content):
            return self.omit("math", link_label=link_label)
        if token.type == "math_block":
            return f"{token.markup}\n{token.content.rstrip()}\n{token.markup}"
        return f"{token.markup}{token.content}{token.markup}"

    def blocks(
        self, tokens: list[Token], list_start: int | None = None, task_item: bool = False
    ) -> str:
        result: list[str] = []
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.type in BLOCK_GROUPS:
                end = closing_token(tokens, index)
                result.append(self.block_group(token, tokens[index + 1 : end], list_start))
                if token.type == "list_item_open" and list_start is not None:
                    list_start += 1
                index = end
            else:
                first_item_paragraph = (
                    task_item and index == 1 and tokens[0].type == "paragraph_open"
                )
                result.append(self.block_token(token, first_item_paragraph))
            index += 1
        return "".join(result)

    def block_group(self, token: Token, children: list[Token], list_start: int | None) -> str:
        if token.type == "table_open":
            return self.table(children)
        ordered_start = token.attrGet("start")
        child_start = (
            (int(ordered_start) if ordered_start is not None else 1)
            if token.type == "ordered_list_open"
            else None
        )
        inner = self.blocks(
            children, list_start=child_start, task_item=token.type == "list_item_open"
        ).rstrip()
        if token.type == "blockquote_open":
            return "\n".join("> " + line for line in inner.splitlines()) + "\n\n"
        if token.type == "list_item_open":
            lines = inner.splitlines() or [""]
            marker = "- " if list_start is None else f"{list_start}. "
            continuation = "\n".join(" " * len(marker) + line for line in lines[1:])
            return marker + lines[0] + "\n" + continuation + "\n\n"
        return inner + "\n\n"

    def block_token(self, token: Token, task_item: bool) -> str:
        if token.type in {"fence", "code_block"}:
            return self.code_block(token)
        if token.type == "math_block":
            return self.math(token) + "\n\n"
        if token.type == "html_block":
            return self.omit("html") + "\n\n"
        if token.type == "heading_open":
            return "#" * int(token.tag[1:]) + " "
        if token.type in {"heading_close", "paragraph_close"}:
            return "\n\n"
        if token.type == "inline":
            return self.block_inline(token, task_item)
        if token.type == "hr":
            return "---\n\n"
        return ""

    def code_block(self, token: Token) -> str:
        language = token.info.strip().split(maxsplit=1)[0] if token.info.strip() else ""
        if language.lower() in {"query", "search"}:
            return self.omit("query") + "\n\n"
        fence = "`" * max(
            3, max((len(item) for item in re.findall(r"`+", token.content)), default=0) + 1
        )
        language = re.sub(r"[^a-zA-Z0-9_+.-]", "", language)[:40]
        return f"{fence}{language}\n{token.content.rstrip()}\n{fence}\n\n"

    def block_inline(self, token: Token, task_item: bool) -> str:
        task = re.match(r"^\[([ xX])\](?:[ \t]+|(?=\n|$))", token.content) if task_item else None
        if not task:
            return self.inline(token.children or [])
        children = (
            self.parser.parseInline(token.content[task.end() :], self.environment)[0].children or []
        )
        return f"[{task[1]}] " + self.inline(children)

    def table(self, tokens: list[Token]) -> str:
        """Serialize one complete table with its own header widths and alignment."""
        result: list[str] = []
        separators: list[str] = []
        alignments = {
            "text-align:left": ":---",
            "text-align:right": "---:",
            "text-align:center": ":---:",
        }
        for token in tokens:
            if token.type == "th_open":
                separators.append(alignments.get(str(token.attrGet("style") or ""), "---"))
            elif token.type == "inline":
                # Plain text already escapes pipes; opaque code and math need
                # the table escape removed by parsing restored separately.
                result.append(self.inline(token.children or [], table_cell=True))
            elif token.type == "tr_open":
                result.append("| ")
            elif token.type in {"th_close", "td_close"}:
                result.append(" | ")
            elif token.type == "tr_close":
                result.append("\n")
            elif token.type == "thead_close":
                result.append("| " + " | ".join(separators) + " |\n")
        return "".join(result) + "\n"

    def render(self) -> list[PublicationPage]:
        pages = []
        for note in self.notes:
            self.current = note
            self.omissions = 0
            self.environment = {}
            body = self.blocks(self.parser.parse(note.body, self.environment)).strip() + "\n"
            pages.append(
                PublicationPage(
                    id=self.ids[note.id], title=note.title, markdown=body, omissions=self.omissions
                )
            )
        return pages
