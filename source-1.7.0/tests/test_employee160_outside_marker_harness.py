import ast
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "release-work" / "employee160-a5-test-harness-g1" / "prepare-outside-marker-fixture.py"


class Employee160OutsideMarkerHarnessTests(unittest.TestCase):
    def test_runtime_symbols_used_at_module_scope_are_imported(self):
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        imported = set()
        used = set()
        for node in tree.body:
            if isinstance(node, ast.Import):
                imported.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.update(alias.asname or alias.name for alias in node.names)
            elif isinstance(node, ast.Expr):
                used.update(n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load))
        self.assertLessEqual(used - imported - {"__file__", "__name__"}, {"main", "r", "e", "result", "sys"})
        self.assertIn("sys", imported)


if __name__ == "__main__":
    unittest.main()
