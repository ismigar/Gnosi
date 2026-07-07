"""CardDAV: els valors vCard PLEGATS (RFC 6350/2426 line folding) s'han de
desplegar abans de parsejar, o notes/adreces llargues es trunquen.

Els servidors CardDAV (Nextcloud, iCloud, Google) parteixen les línies de més
de 75 caràcters amb un CRLF + espai/tab de continuació. El parser per línia
capturava només la primera línia → pèrdua de dades (una ADR podia perdre
ciutat/codi postal/país).
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
    # Abans del fix, tot el que hi havia després del plegat es perdia.
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
