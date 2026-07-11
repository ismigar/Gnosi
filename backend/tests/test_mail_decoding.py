from backend.services.imap_mail_sync_service import _decode_str
from backend.services.hybrid_mail_service import _decode_mime

def test_decode_str_with_unknown_charset():
    # RFC 2047 header with an invalid / unknown charset
    raw_header = "=?unknown-8bit?Q?Prova_de_titol?="
    res = _decode_str(raw_header)
    assert res == "Prova de titol"

def test_decode_mime_with_unknown_charset():
    raw_header = "=?unknown-8bit?Q?Altre_titol?="
    res = _decode_mime(raw_header)
    assert res == "Altre titol"

def test_decode_str_completely_invalid_charset():
    raw_header = "=?codec-inexistent?Q?Text?="
    res = _decode_str(raw_header)
    assert "Text" in res
