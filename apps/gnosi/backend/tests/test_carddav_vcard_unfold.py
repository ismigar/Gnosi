"""CardDAV: FOLDED vCard values (RFC 6350/2426 line folding) must be
unfolded before parsing, or long notes/addresses get truncated.

CardDAV servers (Nextcloud, iCloud, Google) split lines longer than
75 characters with a CRLF + continuation space/tab. The per-line parser
only captured the first line → data loss (an ADR could lose
city/postal code/country).
"""
from backend.services.contacts_sync_engine import CardDAVContactsProvider


def _parse(vcard: str) -> dict:
    prov = CardDAVContactsProvider.__new__(CardDAVContactsProvider)  # bypass __init__
    return prov.parse_to_internal({"vcard": vcard, "href": "/x.vcf"})


FOLDED = (
    "BEGIN:VCARD\r\n"
    "VERSION:3.0\r\n"
    "FN:Joan Exemple\r\n"
    "NOTE:Aquesta és una nota molt llarga que el servidor CardDAV ha plegat\r\n"
    "  en diverses línies perquè supera els setanta-cinc caràcters.\r\n"
    "ADR;TYPE=HOME:;;Carrer de la Diputacio 250 3r 2a nom molt llarg\r\n"
    "  que continua;Barcelona;;08007;Catalunya\r\n"
    "END:VCARD\r\n"
)


def test_nota_plegada_es_recupera_sencera():
    parsed = _parse(FOLDED)
    assert "setanta-cinc caràcters." in parsed["notes"]
    assert "en diverses línies" in parsed["notes"]


def test_adreca_plegada_conserva_ciutat_i_codi_postal():
    parsed = _parse(FOLDED)
    # Before the fix, everything after the fold was lost.
    assert "Barcelona" in parsed["address"]
    assert "08007" in parsed["address"]
    assert "Catalunya" in parsed["address"]


def test_vcard_sense_plegat_segueix_funcionant():
    vcard = (
        "BEGIN:VCARD\r\n"
        "VERSION:3.0\r\n"
        "FN:Anna Curt\r\n"
        "EMAIL:anna@example.com\r\n"
        "TEL:+34600000000\r\n"
        "END:VCARD\r\n"
    )
    parsed = _parse(vcard)
    assert parsed["name"] == "Anna Curt"
    assert parsed["email"] == "anna@example.com"
    assert parsed["phone"] == "+34600000000"
