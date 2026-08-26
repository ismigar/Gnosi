from backend.config.app_config import normalize_interface_language


def test_interface_language_defaults_to_english():
    assert normalize_interface_language(None) == "en"
    assert normalize_interface_language("") == "en"
    assert normalize_interface_language("de") == "en"


def test_interface_language_accepts_supported_values_and_regional_tags():
    assert normalize_interface_language("EN-gb") == "en"
    assert normalize_interface_language("ca-AD") == "ca"
    assert normalize_interface_language("es") == "es"
    assert normalize_interface_language("fr-FR") == "fr"
