"""vCard 3.0 (RFC 2426): els valors de text amb `;` `,` `\\` o salts de línia
s'han d'ESCAPAR en construir el vCard i DESESCAPAR en parsejar-lo.

Sense escapar, una NOTE multilínia trencava tot el vCard (la 2a línia es
parseja com una propietat bogus) i un `;`/`,` a `N`/`ORG`/`ADR` corrompia
l'estructura de camps.
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
    # Cap salt de línia real dins d'un valor (trencaria el vCard):
    assert "Línia u\nlínia dos" not in vcard
    assert "NOTE:Línia u\\nlínia dos" in vcard
    # El `;` de l'empresa va escapat (no fa de separador de components ORG):
    assert "ORG:Acme\\; Inc" in vcard
    # Cada línia del vCard és una propietat vàlida (conté ':').
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
        # Nota: l'ADR és un camp estructurat i el parser col·lapsa components
        # amb `;`; per això la clau d'adreça del round-trip fa servir comes
        # (que sí es preserven). Un `;` LITERAL a l'adreça és un cas ja lossy
        # per disseny del collapse, independent d'aquest fix.
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
        "NOTE:Primera\\nSegona\r\n"          # el servidor ha escapat el salt
        "ORG:Empresa\\, SA\r\n"
        "END:VCARD\r\n"
    )
    parsed = prov.parse_to_internal({"vcard": vcard, "href": "/y.vcf"})
    assert parsed["notes"] == "Primera\nSegona"
    assert parsed["company"] == "Empresa, SA"


def test_helpers_round_trip():
    for s in ["a;b,c\\d", "línia\nnova", "sense res", ";,\\"]:
        assert _vcard_unescape(_vcard_escape(s)) == s.replace("\r", "")
