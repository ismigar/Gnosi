"""vCard 3.0 (RFC 2426): text values containing `;` `,` `\\` or line breaks
must be ESCAPED when building the vCard and UNESCAPED when parsing it.

Without escaping, a multi-line NOTE would break the whole vCard (the 2nd line
gets parsed as a bogus property) and a `;`/`,` in `N`/`ORG`/`ADR` would corrupt
the field structure.
"""
from backend.services.contacts_sync_engine import (
    CardDAVContactsProvider,
    _vcard_escape,
    _vcard_unescape,
)


def _prov():
    return CardDAVContactsProvider.__new__(CardDAVContactsProvider)


def test_build_escapa_salt_de_linia_i_separadors():
    prov = _prov()
    vcard = prov._build_vcard(
        {
            "name": "Anna Prova",
            "notes": "Línia u\nlínia dos",
            "company": "Acme; Inc",
            "address": "Carrer A, 3r; Barcelona",
        },
        uid="uid-1",
    )
    # No real line break inside a value (would break the vCard):
    assert "Línia u\nlínia dos" not in vcard
    assert "NOTE:Línia u\\nlínia dos" in vcard
    # The company's `;` is escaped (it doesn't act as an ORG component separator):
    assert "ORG:Acme\\; Inc" in vcard
    # Each vCard line is a valid property (contains ':').
    for ln in vcard.split("\r\n"):
        assert ln == "" or ":" in ln, ln


def test_round_trip_build_parse_preserva_els_valors():
    prov = _prov()
    original = {
        "name": "Marc Soler",
        "email": "marc@example.com",
        "phone": "+34600111222",
        "company": "Recerca, S.L.; Divisió",
        "job_title": "Cap d'àrea",
        # Note: ADR is a structured field and the parser collapses components
        # with `;`; that's why the round-trip address key uses commas
        # (which ARE preserved). A LITERAL `;` in the address is already a lossy case
        # by design of the collapse, independent of this fix.
        "address": "Av. Diagonal, 100, 4t, Barcelona",
        "notes": "Nota amb\nsalt de línia i coma, i punt i coma;",
    }
    vcard = prov._build_vcard(original, uid="uid-2")
    parsed = prov.parse_to_internal({"vcard": vcard, "href": "/x.vcf"})
    for key in ("name", "email", "phone", "company", "job_title", "address", "notes"):
        assert parsed[key] == original[key], (key, parsed[key], original[key])


def test_parse_desescapa_valors_del_servidor():
    prov = _prov()
    vcard = (
        "BEGIN:VCARD\r\nVERSION:3.0\r\n"
        "FN:Nom\r\n"
        "NOTE:Primera\\nSegona\r\n"          # the server has escaped the newline
        "ORG:Empresa\\, SA\r\n"
        "END:VCARD\r\n"
    )
    parsed = prov.parse_to_internal({"vcard": vcard, "href": "/y.vcf"})
    assert parsed["notes"] == "Primera\nSegona"
    assert parsed["company"] == "Empresa, SA"


def test_helpers_round_trip():
    for s in ["a;b,c\\d", "línia\nnova", "sense res", ";,\\"]:
        assert _vcard_unescape(_vcard_escape(s)) == s.replace("\r", "")
