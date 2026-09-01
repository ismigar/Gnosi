"""Compatibility contracts for the PR6 domain facades."""

from backend.domains.graph import scanning as graph_scanning
from backend.domains.graph import service as graph_domain
from backend.domains.literature import repositories as literature_repositories
from backend.domains.literature import search as literature_search
from backend.domains.notebooks import analysis as notebook_analysis
from backend.domains.notebooks import ingestion as notebook_ingestion
from backend.domains.notebooks import service as notebook_domain
from backend.domains.reader import analysis as reader_analysis_domain
from backend.domains.reader import service as reader_domain
from backend.services import (
    graph_service,
    literature_service,
    notebook_service,
    reader_analysis,
)


def test_notebook_facade_exports_canonical_owners() -> None:
    assert notebook_service.create_notebook is notebook_domain.create_notebook
    assert notebook_service._run_ingest is notebook_ingestion._run_ingest
    assert notebook_service._model_analysis is notebook_analysis._model_analysis


def test_literature_facade_exports_canonical_owners() -> None:
    assert literature_service.catalog is literature_repositories.catalog
    assert literature_service.start_search is literature_search.start_search
    assert literature_service._credential_value is literature_repositories._credential_value


def test_reader_facade_exports_canonical_owners() -> None:
    assert reader_analysis.start_analysis is reader_domain.start_analysis
    assert reader_analysis._run_job is reader_domain._run_job
    assert reader_analysis._build_batches is reader_analysis_domain._build_batches


def test_graph_facade_exports_canonical_owners() -> None:
    assert graph_service.GraphService is graph_domain.GraphService
    assert graph_service.parse_section_links is graph_scanning.parse_section_links
    assert graph_service._DIR_WARMUP_REQUESTED is graph_scanning._DIR_WARMUP_REQUESTED
