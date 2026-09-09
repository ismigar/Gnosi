"""Plugin reads reuse unchanged documents without hiding permission updates."""

import json
import logging
from pathlib import Path

from backend.domains.configuration.plugin_state import PluginStateDependencies, PluginStateStore


def make_store(path, reads):
    def normalize(raw):
        reads.append(raw)
        return raw, False

    return PluginStateStore(PluginStateDependencies(
        path=path,
        normalize_state=normalize,
        write_json=lambda target, data, **kwargs: target.write_text(json.dumps(data)),
        logger=logging.getLogger(__name__),
    ))


def test_unchanged_reads_are_isolated_and_external_replacements_are_visible(tmp_path):
    path = tmp_path / 'plugins.json'
    path.write_text('{"granted":{"plugin":["vault:read"]}}')
    reads = []
    store = make_store(lambda: path, reads)
    first = store.load()
    first['granted']['plugin'].append('vault:write')
    assert store.load() == {'granted': {'plugin': ['vault:read']}}
    assert len(reads) == 1
    replacement = tmp_path / 'replacement.json'
    replacement.write_text('{"granted":{"plugin":[]}}')
    replacement.replace(path)
    assert store.load() == {'granted': {'plugin': []}}
    assert len(reads) == 2
    path.unlink()
    assert store.load() == {}


def test_save_invalidates_cached_state_and_vaults_remain_separate(tmp_path):
    paths = [tmp_path / name for name in ('one.json', 'two.json')]
    for index, path in enumerate(paths):
        path.write_text(json.dumps({'vault': index}))
    active: Path = paths[0]
    store = make_store(lambda: active, [])
    assert store.load() == {'vault': 0}
    active = paths[1]
    assert store.load() == {'vault': 1}
    active = paths[0]
    store.save({'vault': 0, 'disabled': ['plugin']})
    assert store.load() == {'vault': 0, 'disabled': ['plugin']}
    active = paths[1]
    assert store.load() == {'vault': 1}


def test_invalid_documents_do_not_poison_subsequent_reads(tmp_path):
    path = tmp_path / 'plugins.json'
    path.write_text('{}')
    store = make_store(lambda: path, [])
    assert store.load() == {}
    path.write_text('broken')
    assert store.load() == {}
    path.write_text('{"restored":true}')
    assert store.load() == {'restored': True}
