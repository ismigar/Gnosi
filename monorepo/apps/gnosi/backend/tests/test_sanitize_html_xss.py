"""`sanitize_html` removes email XSS and exfiltration vectors.

It strips dangerous tags and URL schemes while preserving legitimate content.
"""
from backend.services.mail_ingester import sanitize_html, _is_safe_url


def test_removes_dangerous_tags():
    html = (
        '<p>ok</p>'
        '<iframe src="https://evil/x"></iframe>'
        '<object data="evil.swf"></object>'
        '<form action="https://evil/steal"><input name="pw"></form>'
        '<embed src="evil">'
    )
    out = sanitize_html(html)
    for frag in ('<iframe', '<object', '<form', '<embed', '<input'):
        assert frag not in out, frag
    assert '<p>ok</p>' in out


def test_removes_javascript_and_data_text_urls():
    html = (
        '<a href="javascript:alert(1)">x</a>'
        '<a href="JavaScript:alert(2)">y</a>'
        '<img src="data:text/html,<script>1</script>">'
        '<a href="vbscript:msgbox(1)">z</a>'
    )
    out = sanitize_html(html)
    assert 'javascript:' not in out.lower()
    assert 'vbscript:' not in out.lower()
    assert 'data:text/html' not in out.lower()


def test_preserves_legitimate_links_and_images():
    html = (
        '<a href="https://ok.example/p">enllaç</a>'
        '<a href="mailto:a@b.com">mail</a>'
        '<a href="#seccio">àncora</a>'
        '<img src="https://ok.example/i.png">'
        '<img src="data:image/png;base64,iVBORw0KGgo=">'
    )
    out = sanitize_html(html)
    assert 'https://ok.example/p' in out
    assert 'mailto:a@b.com' in out
    assert '#seccio' in out
    assert 'https://ok.example/i.png' in out
    assert 'data:image/png' in out  # Allowed inline image.


def test_detects_scheme_obfuscated_with_whitespace():
    # Browsers ignore spaces and control characters inside the scheme.
    assert _is_safe_url("java\tscript:alert(1)") is False
    assert _is_safe_url(" javascript:alert(1)") is False
    assert _is_safe_url("https://ok") is True
    assert _is_safe_url("/relatiu") is True
    assert _is_safe_url("data:image/png;base64,AAAA") is True
    assert _is_safe_url("data:text/html,x") is False
