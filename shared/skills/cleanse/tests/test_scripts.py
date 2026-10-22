import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
# Keeps analysers installed on the developer's machine out of dead_code.py runs.
ISOLATED_PATH = "/usr/bin:/bin"


def run_script(name: str, root: Path) -> str:
    env = {**os.environ, "PATH": ISOLATED_PATH}
    result = subprocess.run([sys.executable, str(SCRIPTS / name), str(root)], capture_output=True,
                            text=True, env=env, check=True)
    return result.stdout


class ProjectTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, content: str = "", executable: bool = False) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content))
        if executable:
            path.chmod(0o755)
        return path


class DeadCodeTest(ProjectTestCase):
    def test_reports_no_project_when_no_stack_markers(self):
        self.assertIn("No JavaScript/TypeScript or Python project", run_script("dead_code.py", self.root))

    def test_runs_installed_analysers_and_lists_missing_ones(self):
        self.write("package.json", "{}")
        self.write("tsconfig.json", "{}")
        self.write("pyproject.toml")
        self.write("node_modules/.bin/knip", "#!/bin/sh\necho 'src/unused.ts: unused file'\nexit 1\n",
                   executable=True)
        self.write("node_modules/.bin/tsc",
                   "#!/bin/sh\necho \"a.ts(1,7): error TS6133: 'x' is declared but its value is never read.\"\n"
                   "echo \"a.ts(2,1): error TS2304: Cannot find name 'y'.\"\nexit 2\n",
                   executable=True)

        output = run_script("dead_code.py", self.root)

        self.assertIn("stacks: javascript, python", output)
        self.assertIn("src/unused.ts: unused file", output)
        self.assertIn("exit 1", output)
        self.assertIn("TS6133", output)
        self.assertNotIn("TS2304", output, "tsc output keeps only unused-code diagnostics")
        not_installed = output.split("## Not installed", 1)[1]
        for name in ("ruff", "vulture", "deptry"):
            self.assertIn(f"- {name} (python)", not_installed)
        self.assertNotIn("knip", not_installed)

    def test_skips_tsc_without_tsconfig(self):
        self.write("package.json", "{}")
        self.assertNotIn("tsc", run_script("dead_code.py", self.root))

    def test_checks_each_referenced_project_of_a_solution_tsconfig(self):
        self.write("package.json", "{}")
        self.write("tsconfig.json", '{"files": [], "references": [{"path": "./tsconfig.app.json"}]}')
        self.write("node_modules/.bin/tsc", """\
            #!/bin/sh
            case "$*" in
              *--showConfig*) echo '{"compilerOptions": {}, "references": [{"path": "./tsconfig.app.json"}]}' ;;
              *"-p ./tsconfig.app.json"*) echo "src/a.ts(1,7): error TS6133: 'x' is declared but never read." ;;
            esac
            """, executable=True)

        output = run_script("dead_code.py", self.root)

        self.assertIn("project: ./tsconfig.app.json", output)
        self.assertIn("src/a.ts(1,7): error TS6133", output)

    def test_prefers_project_virtualenv(self):
        self.write("requirements.txt")
        self.write(".venv/bin/vulture", "#!/bin/sh\necho 'app.py:3: unused function old (60% confidence)'\n",
                   executable=True)
        output = run_script("dead_code.py", self.root)
        self.assertIn(".venv/bin/vulture", output)
        self.assertIn("unused function old", output)


class DocRefsTest(ProjectTestCase):
    def test_reports_missing_references_only(self):
        self.write("src/app.ts")
        self.write("docs/guide.md", "# Guide\n")
        self.write("package.json", json.dumps({"scripts": {"dev": "vite"}}))
        self.write("Makefile", "build:\n\techo hi\n")
        self.write("README.md", """\
            See [guide](docs/guide.md#setup) and [old](docs/removed.md) and [site](https://example.com).
            Entry point `src/app.ts:12` and `src/app.ts:3–4`, removed `src/old.ts`, external `~/.config/x`, glob `src/*.ts`.
            Run `npm run dev` or `npm run start`, then make sure it works. See `src/...` for more.
            Press `  ` to continue, or `npm run --workspace web build` in a monorepo.

            ```sh
            make build
            make deploy
            [not a link](nowhere.md)
            ```
            """)

        output = run_script("doc_refs.py", self.root)

        self.assertIn("README.md:1: missing link target 'docs/removed.md'", output)
        self.assertIn("README.md:2: missing path 'src/old.ts'", output)
        self.assertIn("README.md:3: unknown package script 'start' (package.json)", output)
        self.assertIn("README.md:8: unknown make target 'deploy' (Makefile)", output)
        for reference in ("guide.md", "app.ts", "example.com", "~/.config", "src/*.ts", "'dev'", "'build'",
                          "nowhere.md", "'sure'", "src/...", "--workspace"):
            self.assertNotIn(reference, output.replace("docs/removed.md", ""))
        self.assertTrue(output.rstrip().endswith("4 missing."), output)

    def test_resolves_links_relative_to_the_document(self):
        self.write("docs/a.md", "[b](b.md) [root](../README.md)\n")
        self.write("docs/b.md")
        self.write("README.md")
        self.assertIn("0 missing.", run_script("doc_refs.py", self.root))

    def test_ignores_gitignored_documents(self):
        self.write(".gitignore", "vendor/\n")
        self.write("vendor/README.md", "[x](missing.md)\n")
        self.assertIn("0 missing.", run_script("doc_refs.py", self.root))


class EnvVarsTest(ProjectTestCase):
    def test_reports_drift_in_both_directions(self):
        self.write(".env.example", "DATABASE_URL=\n# OPTIONAL_FLAG=1\nSTALE_KEY=x\n")
        self.write("README.md", "```sh\nexport DOCUMENTED_ONLY=1\n```\nNOT_IN_FENCE=1\n")
        self.write("src/db.ts", "const url = process.env.DATABASE_URL;\nconst k = process.env['API_KEY'];\n"
                                "if (process.env.NODE_ENV) {}\nimport.meta.env.MODE;\n")
        self.write("app/main.py", "import os\nos.getenv('OPTIONAL_FLAG')\nos.environ['SECRET_TOKEN']\n")
        self.write(".env", "LEAKED_SECRET=do-not-read\n")
        self.write("src/db.test.ts", "process.env.TEST_ONLY_FLAG;\n")
        self.write("tests/test_main.py", "os.getenv('PYTEST_ONLY_FLAG')\n")

        output = run_script("env_vars.py", self.root)
        undeclared, unused = output.split("## Declared but not read in code")
        undeclared = undeclared.split("## Read in code but not declared")[1]

        self.assertIn("declared in: .env.example, README.md", output)
        self.assertIn("API_KEY  src/db.ts:2", undeclared)
        self.assertIn("SECRET_TOKEN  app/main.py:3", undeclared)
        self.assertIn("STALE_KEY  .env.example:3", unused)
        self.assertIn("DOCUMENTED_ONLY  README.md:2", unused)
        for absent in ("DATABASE_URL", "OPTIONAL_FLAG", "NODE_ENV", "MODE", "NOT_IN_FENCE", "LEAKED_SECRET",
                       "TEST_ONLY_FLAG", "PYTEST_ONLY_FLAG"):
            self.assertNotIn(absent, undeclared + unused)

    def test_without_template_lists_everything_read(self):
        self.write("main.py", "import os\nos.environ.get('PORT')\n")
        output = run_script("env_vars.py", self.root)
        self.assertIn("(no env template", output)
        self.assertIn("PORT  main.py:2", output)


if __name__ == "__main__":
    unittest.main()
