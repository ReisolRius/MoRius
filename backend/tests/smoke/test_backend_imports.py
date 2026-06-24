from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


class BackendSmokeTests(unittest.TestCase):
    def test_all_router_and_service_modules_import(self) -> None:
        import app.routers
        import app.services

        for package in (app.routers, app.services):
            for module_info in pkgutil.iter_modules(package.__path__, package.__name__ + "."):
                with self.subTest(module=module_info.name):
                    importlib.import_module(module_info.name)

    def test_app_registers_health_route(self) -> None:
        from app.main import app
        from app.routers.health import health_check

        self.assertTrue(any(getattr(route, "path", "") == "/api/health" for route in app.routes))
        self.assertEqual(health_check().message, "ok")


if __name__ == "__main__":
    unittest.main()
