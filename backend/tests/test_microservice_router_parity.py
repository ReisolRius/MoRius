"""A router added to the monolith must also be reachable in gateway mode.

Production runs `APP_MODE=gateway`, which does not use `app/main.py` at all: the gateway
assembles itself from `_PREFIX_TO_ROUTER_MODULES` filtered by its own prefix whitelist. So a
router wired only into the monolith imports fine, passes every other test, and then 404s on the
live site - which is exactly how `/api/public/landing/showcase` shipped broken.
"""

from __future__ import annotations

import ast
import pathlib

from app.microservices.factory import _PREFIX_TO_ROUTER_MODULES

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _routers_included_by_the_monolith() -> set[str]:
    """Every `app.routers.X` the monolith imports a `router` from."""
    source = (BACKEND_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.routers."):
            if any(alias.name == "router" for alias in node.names):
                modules.add(node.module)
    return modules


def _routers_reachable_in_service_mode() -> set[str]:
    return {module for modules in _PREFIX_TO_ROUTER_MODULES.values() for module in modules}


def test_every_monolith_router_is_mapped_for_service_mode() -> None:
    missing = sorted(_routers_included_by_the_monolith() - _routers_reachable_in_service_mode())
    assert not missing, (
        "These routers are in app/main.py but absent from _PREFIX_TO_ROUTER_MODULES, so they "
        "would 404 under APP_MODE=gateway: " + ", ".join(missing)
    )


def test_mapped_prefixes_match_the_routes_they_serve() -> None:
    """A module mapped under a prefix must actually own routes beneath it."""
    import importlib

    mismatched: list[str] = []
    for prefix, module_paths in _PREFIX_TO_ROUTER_MODULES.items():
        for module_path in module_paths:
            router = getattr(importlib.import_module(module_path), "router", None)
            assert router is not None, f"{module_path} exports no `router`"
            paths = [route.path for route in router.routes if hasattr(route, "path")]
            if paths and not any(path.startswith(prefix) for path in paths):
                mismatched.append(f"{module_path} mapped to {prefix} but serves {paths[:2]}")
    assert not mismatched, "; ".join(mismatched)


def test_public_landing_showcase_is_served_by_the_gateway() -> None:
    from app.microservices.gateway_main import app

    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert "/api/public/landing/showcase" in paths
