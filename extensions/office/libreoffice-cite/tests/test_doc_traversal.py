"""Document traversal for the LibreOffice Gnosi Cite extension.

`gnosi_cite.py` imports `uno` at module level, so it cannot be imported
outside LibreOffice. Stubbing those modules lets the pure traversal logic run
under plain CPython, which is what makes this component testable at all — the
UNO-coupled parts (dialogs, dispatch) stay out of scope here.

What is under test is `DocOps._ordered_pairs`: the walk that decides which
citations exist and in what order. Order is not cosmetic — APA disambiguation
(2020a/2020b, "et al.") is defined by first vs. subsequent occurrence, so a
citation the walk misses or misplaces is formatted wrongly.
"""
import sys
import types
import unittest.mock as mock
from pathlib import Path

import pytest

EXT_DIR = Path(__file__).resolve().parent.parent


def _install_uno_stubs():
    """Register the minimum com.sun.star surface gnosi_cite imports."""
    uno = types.ModuleType("uno")
    uno.createUnoStruct = lambda *a, **k: mock.MagicMock()
    sys.modules["uno"] = uno

    unohelper = types.ModuleType("unohelper")
    # A distinct class, not `object`: listing plain `object` ahead of the
    # other interface bases makes the MRO unlinearizable.
    unohelper.Base = type("Base", (object,), {})
    unohelper.ImplementationHelper = lambda *a, **k: mock.MagicMock()
    sys.modules["unohelper"] = unohelper

    for path, names in {
        "com.sun.star.frame": ["XDispatchProvider", "XDispatch"],
        "com.sun.star.lang": ["XServiceInfo", "XInitialization"],
        "com.sun.star.awt": ["XActionListener", "XTextListener"],
    }.items():
        module = types.ModuleType(path)
        for name in names:
            setattr(module, name, type(name, (object,), {}))
        sys.modules[path] = module

    control_chars = types.ModuleType("com.sun.star.text.ControlCharacter")
    control_chars.PARAGRAPH_BREAK = 0
    sys.modules["com.sun.star.text.ControlCharacter"] = control_chars
    for pkg in ("com", "com.sun", "com.sun.star", "com.sun.star.text"):
        sys.modules.setdefault(pkg, types.ModuleType(pkg))


@pytest.fixture(scope="module")
def gnosi_cite():
    """Import the extension module with the UNO surface faked out."""
    _install_uno_stubs()
    sys.path.insert(0, str(EXT_DIR))
    try:
        import gnosi_cite as module
    finally:
        sys.path.remove(str(EXT_DIR))
    return module


# --- fake UNO document model ------------------------------------------------

class FakeMark:
    def __init__(self, name):
        self.Name = name


class FakePortion:
    def __init__(self, kind, mark_name=None, is_start=True):
        self.TextPortionType = kind
        self.IsStart = is_start
        self.ReferenceMark = FakeMark(mark_name) if mark_name else None


class FakeEnum:
    def __init__(self, items):
        self._items = list(items)
        self._i = 0

    def hasMoreElements(self):
        return self._i < len(self._items)

    def nextElement(self):
        item = self._items[self._i]
        self._i += 1
        return item


class FakeParagraph:
    def __init__(self, portions):
        self._portions = portions

    def supportsService(self, name):
        return name == "com.sun.star.text.Paragraph"

    def createEnumeration(self):
        return FakeEnum(self._portions)


class FakeText:
    def __init__(self, elements):
        self._elements = elements

    def createEnumeration(self):
        return FakeEnum(self._elements)


class FakeTable:
    """A table whose cells are themselves XText containers."""

    def __init__(self, cells):
        self._cells = cells

    def supportsService(self, name):
        return name == "com.sun.star.text.TextTable"

    def getCellNames(self):
        return list(self._cells.keys())

    def getCellByName(self, name):
        return self._cells[name]


class BrokenParagraph:
    """Raises on enumeration, standing in for a malformed element."""

    def supportsService(self, name):
        return name == "com.sun.star.text.Paragraph"

    def createEnumeration(self):
        raise RuntimeError("unreadable element")


@pytest.fixture
def walk(gnosi_cite):
    """Return helpers that build a fake document and walk it.

    Yields:
        A (run, para, mark) triple: `run(elements)` returns the citation keys
        the traversal finds, `para(*keys)` builds a paragraph carrying those
        citations, and `mark(key)` builds a single mark name.
    """
    ops = gnosi_cite.DocOps.__new__(gnosi_cite.DocOps)
    prefix = gnosi_cite.MARK_PREFIX
    seq = [0]

    def mark(key):
        # Real shape is <prefix><key>::<uuid>; _key_from_name treats the last
        # "::" segment as the uuid and rejects a name without one.
        seq[0] += 1
        return "%s%s::%032x" % (prefix, key, seq[0])

    def para(*keys):
        return FakeParagraph([FakePortion("ReferenceMark", mark(k)) for k in keys])

    def run(elements):
        ops.doc = mock.MagicMock()
        ops.doc.getText.return_value = FakeText(elements)
        return [key for _name, key in ops._ordered_pairs()]

    return run, para, mark


def _two_cell_table(para):
    return FakeTable({"A1": FakeText([para("t1")]),
                      "B1": FakeText([para("t2")])})


def test_body_paragraphs(walk):
    run, para, _ = walk
    assert run([para("a1"), para("b2")]) == ["a1", "b2"]


def test_citations_inside_table_cells_are_found(walk):
    run, para, _ = walk
    elements = [para("a1"), _two_cell_table(para), para("z9")]
    assert run(elements) == ["a1", "t1", "t2", "z9"]


def test_table_cells_keep_reading_order(walk):
    """Cells belong where the table sits, not appended after the body."""
    run, para, _ = walk
    assert run([_two_cell_table(para), para("after")]) == ["t1", "t2", "after"]


def test_nested_tables_recurse(walk):
    run, para, _ = walk
    inner = FakeTable({"A1": FakeText([para("deep")])})
    outer = FakeTable({"A1": FakeText([inner])})
    assert run([outer]) == ["deep"]


def test_self_referencing_table_terminates(walk):
    """A table that contains itself must hit the nesting bound, not recurse."""
    run, _para, _ = walk
    evil = FakeTable({})
    evil._cells = {"A1": FakeText([evil])}
    assert run([evil]) == []


def test_duplicates_are_preserved(walk):
    """Disambiguation counts occurrences, so repeats must survive the walk."""
    run, para, _ = walk
    assert run([para("x", "x")]) == ["x", "x"]


def test_range_marks_counted_once(walk):
    """A mark spanning a range yields a start and an end portion."""
    run, _para, mark = walk
    name = mark("s")
    span = FakeParagraph([FakePortion("ReferenceMark", name, is_start=True),
                          FakePortion("ReferenceMark", name, is_start=False)])
    assert run([span]) == ["s"]


def test_malformed_element_does_not_abort_the_walk(walk):
    """One unreadable element must not silently truncate the rest.

    The traversal used to wrap the whole loop in a single try/except, so a
    bad element stopped every citation after it from being reformatted.
    """
    run, para, _ = walk
    elements = [para("before"), BrokenParagraph(), para("after")]
    assert run(elements) == ["before", "after"]


def test_non_citation_portions_ignored(walk):
    run, para, mark = walk
    plain = FakeParagraph([FakePortion("Text"),
                           FakePortion("ReferenceMark", mark("k"))])
    assert run([plain]) == ["k"]
