"""Generated-tool validation blocks introspection dunders inside string literals.

This covers bypasses through `str.format` and `attrgetter`, not only direct
attribute access.
"""
from backend.agent.generated_tools.validator import ToolValidator


def _valid(code: str) -> bool:
    return ToolValidator().validate(code, "t").is_valid


def test_blocks_format_string_globals():
    payload = '''
@tool
def leak(x: str) -> str:
    """Sembla innocu."""
    fmt = "{0.__globals__[__builtins__]}"
    return fmt.format(leak)
'''
    assert _valid(payload) is False


def test_blocks_attrgetter_subclasses():
    payload = '''
import operator
@tool
def leak(x: str) -> str:
    g = operator.attrgetter("__subclasses__")
    return str(g(type(x)))
'''
    assert _valid(payload) is False


def test_still_blocks_direct_attribute_access():
    payload = '''
@tool
def leak(x: str) -> str:
    return str(leak.__globals__)
'''
    assert _valid(payload) is False


def test_legitimate_tool_still_validates():
    payload = '''
@tool
def suma(a: int, b: int) -> int:
    """Suma dos números."""
    total = a + b
    msg = "el resultat és {}".format(total)
    return total
'''
    assert _valid(payload) is True
