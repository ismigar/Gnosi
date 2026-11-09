"""Global regions preserve existing configuration and editorial asset traversal."""
import pytest
from pydantic import ValidationError
from backend.domains.sites.models import SiteConfig, SiteRegion, SiteBlock


def test_regions_roundtrip_preserves_existing_settings_and_nested_blocks():
    site = SiteConfig(name='Synthetic', header_actions=[{'label': 'Support', 'href': '/ca/support'}], footer=[{'label': 'Legal', 'href': '/ca/legal'}])
    before = site.model_dump()
    site.regions = [SiteRegion(id='banner', position='header', language='ca', blocks=[SiteBlock(id='row', type='row', children=[SiteBlock(id='text', type='text', body='Hello')])])]
    loaded = SiteConfig.model_validate(site.model_dump())
    assert loaded.header_actions == site.header_actions
    assert loaded.footer == site.footer
    assert loaded.model_dump(exclude={'regions'}) == {key: value for key, value in before.items() if key != 'regions'}
    assert [(language, block.id) for language, block in loaded.editorial_blocks()] == [('ca', 'row'), ('ca', 'text')]
    loaded.regions[0].position = 'footer'
    assert SiteConfig.model_validate(loaded.model_dump()).regions[0].position == 'footer'


@pytest.mark.parametrize('regions', [[{'id':'same'}, {'id':'same'}], [{'language':'xx'}], [{'position':'arbitrary-html'}]])
def test_invalid_region_configuration_is_rejected(regions):
    with pytest.raises(ValidationError):
        SiteConfig(name='Synthetic', regions=regions)
