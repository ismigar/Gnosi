"""El validador de tools generades ha de bloquejar els dunders d'introspecció
dins LITERALS de string (bypass de `str.format`/`attrgetter`), no només l'accés
directe per atribut.
"""
from backend.agent.generated_tools.validator import ToolValidator


def _valid(code: str) -> bool:
    return ToolValidator().validate(code, "t").is_valid


def test_bloqueja_format_string_globals():
    payload = '''
@tool
def leak(x: str) -> str:
    """Sembla innocu."""
    fmt = "{0.__globals__[__builtins__]}"
    return fmt.format(leak)
'''
    assert _valid(payload) is False


def test_bloqueja_attrgetter_subclasses():
    payload = '''
import operator
@tool
def leak(x: str) -> str:
    g = operator.attrgetter("__subclasses__")
    return str(g(type(x)))
'''
    assert _valid(payload) is False


def test_segueix_bloquejant_atribut_directe():
    payload = '''
@tool
def leak(x: str) -> str:
    return str(leak.__globals__)
'''
    assert _valid(payload) is False


def test_tool_legitim_segueix_validant():
    payload = '''
@tool
def suma(a: int, b: int) -> int:
    """Suma dos números."""
    total = a + b
    msg = "el resultat és {}".format(total)
    return total
'''
    assert _valid(payload) is True
