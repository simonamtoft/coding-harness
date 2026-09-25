import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path.cwd()


class SalesTests(unittest.TestCase):
    def test_cli_and_reusable_function(self):
        from examples.probe_sales import summarize

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'in.csv'
            output = Path(directory) / 'out.csv'
            source.write_text('region,revenue\nEast,0.10\nWest,1.05\nEast,0.20\n,4.00\n', encoding='utf-8')
            summarize(source, output)
            with output.open(newline='') as handle:
                self.assertEqual(list(csv.reader(handle)), [['region', 'revenue'], ['East', '0.30'], ['West', '1.05']])
            output.unlink()
            subprocess.run([sys.executable, 'examples/probe_sales_cli.py', str(source), str(output)], check=True, cwd=ROOT)
            with output.open(newline='') as handle:
                self.assertEqual(list(csv.reader(handle)), [['region', 'revenue'], ['East', '0.30'], ['West', '1.05']])


if __name__ == '__main__':
    unittest.main()
