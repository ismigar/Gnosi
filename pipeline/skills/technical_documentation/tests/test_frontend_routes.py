"""Static frontend route discovery for legacy and split TypeScript applications."""

from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts.generate import (
    FrontendRoute,
    build_frontend_catalog,
    collect_frontend_routes,
    resolve_frontend_import,
)


APP_ROOT = Path(__file__).resolve().parents[4]


def write_source(root: Path, relative: str, text: str) -> None:
    """Create synthetic source only inside the test-owned fixture directory."""
    path = root / "frontend" / "src" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_frontend_routes_keep_legacy_jsx_and_lazy_source_links(tmp_path: Path) -> None:
    """The original single-file app still catalogs paths, imports and redirects."""
    write_source(tmp_path, "App.jsx", """
import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
const Reader = lazy(() => import('./pages/Reader'));
export default function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/reader/:id" element={<Reader />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
""")
    write_source(tmp_path, "pages/Home.jsx", "export default function Home() {}")
    write_source(tmp_path, "pages/Reader.jsx", "export default function Reader() {}")

    assert collect_frontend_routes(tmp_path) == [
        FrontendRoute("/", "Home", "frontend/src/pages/Home.jsx"),
        FrontendRoute("/reader/:id", "Reader", "frontend/src/pages/Reader.jsx"),
        FrontendRoute("*", "Navigate", "react-router-dom"),
    ]
    catalog = build_frontend_catalog(tmp_path)
    assert "| `/reader/:id` | `Reader` | [`frontend/src/pages/Reader.jsx`]" in catalog
    assert catalog == build_frontend_catalog(tmp_path)


def test_frontend_routes_follow_split_tsx_module_imports(tmp_path: Path) -> None:
    """A thin App needs no fake JSX facade; each route resolves its own imports."""
    write_source(tmp_path, "app/App.tsx", """
import { ApplicationRoutes, SharedRoutes } from './routes';
export default function App() { return <><ApplicationRoutes /><SharedRoutes /></>; }
""")
    write_source(tmp_path, "app/routes.tsx", """
import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './Home';
import { Dashboard, ComposerPage as Compose } from '../features/social';
import { SharedPage } from '../features/sharing/index';
const Reader = lazy(() =>
  import('../pages/Reader').then((module) => ({ default: module.Reader })),
);
function VaultRouteScope({ children }: { children: React.ReactNode }) { return children; }
function LegacyVaultRedirect() { return <Navigate to="/" replace />; }
export function SharedRoutes() {
  return <Routes><Route path="/s/:token" element={<SharedPage />} /></Routes>;
}
export function ApplicationRoutes() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/compose" element={<Compose />} />
    <Route path="/reader/:id" element={<Reader />} />
    <Route path="/:vaultHandle/graph/*" element={<VaultRouteScope><GraphPage /></VaultRouteScope>} />
    <Route path="/vault/*" element={<LegacyVaultRedirect />} />
    <Route
      path="*"
      element={
        <Navigate to="/" replace />
      }
    />
  </Routes>;
}
""")
    for relative in (
        "app/Home.tsx", "features/social/index.ts", "features/sharing/index.ts",
        "pages/Reader.tsx",
    ):
        write_source(tmp_path, relative, "export const fixture = true;")
    expected = [
        FrontendRoute("/s/:token", "SharedPage", "frontend/src/features/sharing/index.ts"),
        FrontendRoute("/", "Home", "frontend/src/app/Home.tsx"),
        FrontendRoute("/dashboard", "Dashboard", "frontend/src/features/social/index.ts"),
        FrontendRoute("/compose", "Compose", "frontend/src/features/social/index.ts"),
        FrontendRoute("/reader/:id", "Reader", "frontend/src/pages/Reader.tsx"),
        FrontendRoute("/:vaultHandle/graph/*", "VaultRouteScope", "frontend/src/app/routes.tsx"),
        FrontendRoute("/vault/*", "LegacyVaultRedirect", "frontend/src/app/routes.tsx"),
        FrontendRoute("*", "Navigate", "react-router-dom"),
    ]

    assert not (tmp_path / "frontend/src/App.jsx").exists()
    assert collect_frontend_routes(tmp_path) == expected
    catalog = build_frontend_catalog(tmp_path)
    route_table = catalog.split("## Application routes\n", 1)[1].split("## Source groups", 1)[0]
    assert route_table.count("\n| `") == len(expected)
    assert "unresolved" not in route_table
    assert catalog == build_frontend_catalog(tmp_path)


def test_frontend_routes_exclude_tests_fixtures_builds_and_non_router_components(
    tmp_path: Path,
) -> None:
    """Scanning production source cannot turn a fixture or icon into a route."""
    source = """
import { Route } from 'react-router-dom';
export const Routes = <Route path="/real" element={<Home />} />;
"""
    write_source(tmp_path, "app/routes.tsx", source)
    for relative in (
        "app/routes.test.tsx", "app/routes.spec.jsx", "app/__tests__/router.tsx",
        "tests/router.tsx", "fixtures/router.tsx", "__fixtures__/router.tsx",
        "dist/router.tsx", "node_modules/router.tsx",
    ):
        write_source(tmp_path, relative, source.replace("/real", "/fixture"))
    write_source(tmp_path, "app/Icon.tsx", source.replace("react-router-dom", "lucide-react"))

    assert collect_frontend_routes(tmp_path) == [FrontendRoute("/real", "Home", "unresolved")]


def test_frontend_routes_fail_if_no_production_routes_remain(tmp_path: Path) -> None:
    """An obsolete discovery strategy must fail instead of publishing an empty table."""
    write_source(tmp_path, "app/App.tsx", "export default function App() { return null; }")

    with pytest.raises(ValueError, match="No literal React Router routes"):
        build_frontend_catalog(tmp_path)


def test_frontend_route_import_resolution_is_deterministic_and_source_only(tmp_path: Path) -> None:
    """Ambiguous suffixes resolve stably, and imports never link local non-source data."""
    for relative in ("app/Page.tsx", "app/Page.jsx"):
        write_source(tmp_path, relative, "export default function Page() {}")
    importer = tmp_path / "frontend/src/app/routes.tsx"

    assert resolve_frontend_import("./Page", tmp_path, importer=importer) == (
        "frontend/src/app/Page.tsx"
    )
    assert resolve_frontend_import("./Page.jsx", tmp_path, importer=importer) == (
        "frontend/src/app/Page.jsx"
    )
    assert resolve_frontend_import("../../../outside", tmp_path, importer=importer) == (
        "../../../outside"
    )


def test_frontend_routes_inventory_preserves_current_application_routes() -> None:
    """Inspect real source without generating outputs or importing the application."""
    routes = collect_frontend_routes(APP_ROOT)
    expected_paths = {
        "/s/:token", "/", "/dashboard", "/:vaultHandle/graph/*",
        "/:vaultHandle/knowledge/document", "/:vaultHandle/knowledge/*",
        "/:vaultHandle/calendar/*", "/:vaultHandle/reader/*", "/:vaultHandle/mail/*",
        "/:vaultHandle/automations/*", "/:vaultHandle/social/compose/*",
        "/:vaultHandle/social/*", "/:vaultHandle/media/*", "/:vaultHandle/contacts/*",
        "/:vaultHandle/planning/*", "/:vaultHandle/resources/*",
        "/:vaultHandle/notebooks/:notebookId", "/:vaultHandle/notebooks/*",
        "/graph", "/vault/*", "/calendar", "/reader", "/mail", "/scheduler",
        "/composer", "/social-dashboard", "/media", "/contacts", "/planning",
        "/literature", "/notebooks/*", "*",
    }

    assert {route.path for route in routes} == expected_paths
    assert len(routes) == len(expected_paths) == 32
    assert all(route.source != "unresolved" for route in routes)
    assert FrontendRoute("/s/:token", "SharedPage", "frontend/src/features/sharing/index.ts") in routes
    assert FrontendRoute("/vault/*", "LegacyVaultRedirect", "frontend/src/app/routes.tsx") in routes
