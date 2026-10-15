"""Bounded query grammar shared by global and embedded Vault searches."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal, TypeAlias

import regex


class SearchQueryError(ValueError):
    """A query cannot be evaluated safely or is syntactically incomplete."""


FIELDS = frozenset(
    {
        "title",
        "path",
        "file",
        "tag",
        "is",
        "content",
        "line",
        "block",
        "section",
        "task",
        "task-todo",
        "task-done",
    }
)


@dataclass(frozen=True)
class Term:
    pattern: regex.Pattern[str]
    literal: str | None = None


def normalize_text(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", value.casefold())
        if not unicodedata.combining(char)
    )


@dataclass(frozen=True)
class Scope:
    field: str
    child: Expression


@dataclass(frozen=True)
class Boolean:
    operator: Literal["AND", "OR", "NOT"]
    children: tuple[Expression, ...]


Expression: TypeAlias = Term | Scope | Boolean


def tag_expression(expression: Expression) -> Expression:
    """Apply hierarchical literal matching to every term inside a tag group."""
    if isinstance(expression, Term) and expression.literal is not None:
        literal = expression.literal.lstrip("#")
        return Term(regex.compile(r"^" + regex.escape(literal) + r"(?:/|$)", regex.IGNORECASE))
    if isinstance(expression, Boolean):
        return Boolean(
            expression.operator, tuple(tag_expression(child) for child in expression.children)
        )
    return expression


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    flags: str = ""


def _delimited_token(query: str, start: int) -> tuple[Token, int]:
    delimiter = query[start]
    index = start + 1
    value = ""
    while index < len(query) and query[index] != delimiter:
        if query[index] == "\\" and index + 1 < len(query):
            value += query[index : index + 2] if delimiter == "/" else query[index + 1]
            index += 2
        else:
            value += query[index]
            index += 1
    if index == len(query):
        raise SearchQueryError("Unclosed phrase or regular expression")
    index += 1
    flags = ""
    if delimiter == "/":
        while index < len(query) and query[index].isalpha():
            flags += query[index]
            index += 1
        if any(flag not in "ims" for flag in flags):
            raise SearchQueryError("Regular expression flags must be i, m or s")
    return Token("regex" if delimiter == "/" else "literal", value, flags), index


def tokenize(query: str) -> list[Token]:
    if len(query) > 2000:
        raise SearchQueryError("Query exceeds 2000 characters")
    tokens: list[Token] = []
    i = 0
    while i < len(query):
        char = query[i]
        if char.isspace():
            i += 1
            continue
        if char in "()-":
            tokens.append(Token(char, char))
            i += 1
        elif char == "[":
            end = query.find("]", i + 1)
            if end < 0:
                raise SearchQueryError("Unclosed property filter")
            key, separator, value = query[i + 1 : end].partition(":")
            if not key.strip():
                raise SearchQueryError("Property name is required")
            tokens.extend(
                (
                    Token("field", "property:" + key.strip()),
                    Token("literal", value.strip().strip('"') if separator else ""),
                )
            )
            i = end + 1
        elif char in '"/':
            token, i = _delimited_token(query, i)
            tokens.append(token)
        else:
            field_match = re.match(r"([\w-]+):", query[i:])
            if field_match and field_match[1] in FIELDS:
                tokens.append(Token("field", field_match[1]))
                i += len(field_match[0])
                continue
            start = i
            while i < len(query) and not query[i].isspace() and query[i] not in "()":
                i += 1
            value = query[start:i]
            tokens.append(Token(value if value in {"AND", "OR", "NOT"} else "literal", value))
        if len(tokens) > 256:
            raise SearchQueryError("Too many query terms")
    return tokens


class Parser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.index = 0

    def peek(self) -> str:
        return self.tokens[self.index].kind if self.index < len(self.tokens) else "end"

    def expression(self, depth: int = 0) -> Expression:
        if depth > 20:
            raise SearchQueryError("Query nesting exceeds 20 levels")
        terms = [self.conjunction(depth)]
        while self.peek() == "OR":
            self.index += 1
            terms.append(self.conjunction(depth))
        return terms[0] if len(terms) == 1 else Boolean("OR", tuple(terms))

    def conjunction(self, depth: int) -> Expression:
        terms = [self.atom(depth)]
        while self.peek() not in {"end", ")", "OR"}:
            if self.peek() == "AND":
                self.index += 1
            terms.append(self.atom(depth))
        return terms[0] if len(terms) == 1 else Boolean("AND", tuple(terms))

    def atom(self, depth: int) -> Expression:
        if depth > 20:
            raise SearchQueryError("Query nesting exceeds 20 levels")
        kind = self.peek()
        if kind in {"NOT", "-"}:
            self.index += 1
            return Boolean("NOT", (self.atom(depth + 1),))
        if kind == "(":
            self.index += 1
            result = self.expression(depth + 1)
            if self.peek() != ")":
                raise SearchQueryError("Unclosed query group")
            self.index += 1
            return result
        if kind == "field":
            field = self.tokens[self.index].value
            self.index += 1
            child = self.atom(depth + 1)
            if field == "tag":
                child = tag_expression(child)
            return Scope(field, child)
        if kind not in {"literal", "regex"}:
            raise SearchQueryError("Expected a search term")
        token = self.tokens[self.index]
        self.index += 1
        flags = regex.IGNORECASE if token.kind == "literal" or "i" in token.flags else 0
        if "m" in token.flags:
            flags |= regex.MULTILINE
        if "s" in token.flags:
            flags |= regex.DOTALL
        try:
            literal = normalize_text(token.value) if token.kind == "literal" else None
            return Term(
                regex.compile(token.value if literal is None else regex.escape(literal), flags),
                literal,
            )
        except regex.error as error:
            raise SearchQueryError("Invalid regular expression") from error


def parse_query(query: str) -> Expression | None:
    tokens = tokenize(query)
    if not tokens:
        return None
    parser = Parser(tokens)
    result = parser.expression()
    if parser.peek() != "end":
        raise SearchQueryError("Unexpected closing parenthesis")
    return result
