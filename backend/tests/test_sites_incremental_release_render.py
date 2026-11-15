"""Publication has its own authenticated render cache, never preview authority."""
import json
import os
from types import SimpleNamespace

import pytest

from backend.domains.sites import publication, preview_render_cache as cache
from backend.domains.sites.models import SiteBundle, SiteTarget
from backend.tests.test_sites_incremental_preview import bundle, documents


def reviewed():
    return SiteBundle.model_validate({k:v for k,v in bundle().items() if not k.startswith('deployment_')})


def test_release_context_is_target_scoped_and_restored_after_failure(tmp_path,monkeypatch):
    data=reviewed();store=SimpleNamespace(site_dir=lambda _:tmp_path)
    monkeypatch.setattr(publication,'_phase',lambda *args:None)
    monkeypatch.setattr(publication.local_artifacts,'prepare',lambda *args:tmp_path/'output')
    def render(*args):
        assert cache.release_cache_root.get()==tmp_path/'release-render-cache'/'prod'
        assert cache.preview_cache_root.get() is None
        raise ValueError('synthetic renderer failure')
    monkeypatch.setattr(publication.runtime,'render_bundle',render)
    with pytest.raises(ValueError,match='synthetic'):
        publication._build_release(store,SimpleNamespace(),data.site,SiteTarget(id='prod',adapter='ssh',environment='production'),data)
    assert cache.release_cache_root.get() is None


@pytest.mark.skipif(os.name!='posix',reason='Authenticated cache uses POSIX filesystem checks')
def test_real_production_render_reuses_unchanged_routes_separately_from_previews(tmp_path,monkeypatch):
    root=tmp_path.resolve();data=reviewed();store=SimpleNamespace(site_dir=lambda _:root/'private')
    target=SiteTarget(id='prod',adapter='ssh',environment='production',base_url='https://example.invalid',enabled=True)
    monkeypatch.setattr(publication,'_phase',lambda *args:None)
    monkeypatch.setattr(publication.local_artifacts,'prepare',lambda _,site,release:root/release)
    monkeypatch.setattr(publication.local_artifacts,'seal',lambda *args:None)
    _,first,_=publication._build_release(store,SimpleNamespace(),data.site,target,data)
    _,second,_=publication._build_release(store,SimpleNamespace(),data.site,target,data)
    def stats(output):
        return next(json.loads(x)['incremental'] for x in output.with_name(output.name+'.build.log').read_text().splitlines() if x.startswith('{"incremental":'))
    assert stats(second)==dict(rendered=0,reused=stats(first)['rendered'],search_rebuilt=False)
    assert documents(first)==documents(second)
    assert not (root/'private/render-cache').exists()
    assert cache.release_cache_root.get() is None
