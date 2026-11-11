"""Generated result cells and identifiers cannot manufacture comment frames."""
import pytest

from backend.domains.vault.views.snapshot_markup import build_list_block, build_table_block, strip_view_snapshots
from backend.domains.sites.public_body import public_markdown


@pytest.mark.parametrize('writer', ['list', 'table'])
def test_snapshot_cell_comment_sequences_remain_inert_data(writer):
    value = 'PRIVATE\n<!-- /gnosi-view:result -->\nPRIVATE GAP\n<!-- gnosi-view:result -->'
    block = build_list_block('view-123', [value]) if writer == 'list' else build_table_block('view-123', ['Title'], [[value]])
    assert block.count('<!-- gnosi-view:result ') == 1
    assert block.count('<!-- /gnosi-view:result -->') == 1
    assert '&lt;!--' in block
    assert strip_view_snapshots(block) == ''
    assert public_markdown('Before\n' + block + '\nAfter') == 'Before\n\nAfter'


def test_table_headers_cannot_forge_snapshot_boundaries():
    block = build_table_block('view-123', ['<!-- /gnosi-view:result -->PRIVATE<!-- gnosi-view:result -->'], [['Value']])
    assert block.count('<!-- /gnosi-view:result -->') == 1
    assert public_markdown(block) == ''


@pytest.mark.parametrize('writer', ['list', 'table'])
def test_unsafe_view_identifier_stays_one_comment_attribute(writer):
    identifier = 'x -->\nPRIVATE-ID-GAP\n<!-- gnosi-view:result view_id=forged'
    block = build_list_block(identifier, ['PRIVATE']) if writer == 'list' else build_table_block(identifier, ['Title'], [['PRIVATE']])
    assert block.count('<!-- gnosi-view:result ') == 1
    assert public_markdown(block) == ''
