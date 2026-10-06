import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path.cwd()

# Region first, so a byte-order mark that is not stripped corrupts the region column name.
EXPORT = (
    'region,date,note,amount\r\n'
    ' north,2026-09-01,web,"1,204.50"\r\n'
    'North ,2026-09-01,store,(4.50)\r\n'
    'SOUTH,2026-09-02,web,$310.00\r\n'
    ',2026-09-02,web,19.99\r\n'
    'South,2026-09-03,store,n/a\r\n'
    'east,2026-09-03,web,($12.25)\r\n'
    'West,2026-09-04,web,1e3\r\n'
    '   ,2026-09-04,web,5.00\r\n'
    'West,2026-09-04,web,2.005\r\n'
    'East,2026-09-05,web,-0.005\r\n'
    'South,2026-09-05,"store, mall",-10.015\r\n'
    'North,2026-09-06,web,\r\n'
)

NET = [
    ['region', 'net'],
    ['EAST', '-12.26'],
    ['NORTH', '1200.00'],
    ['SOUTH', '299.99'],
    ['WEST', '2.01'],
]

REJECTS = [
    ['row', 'region', 'amount'],
    ['4', '', '19.99'],
    ['5', 'South', 'n/a'],
    ['7', 'West', '1e3'],
    ['8', '   ', '5.00'],
    ['12', 'North', ''],
]


def read_csv(path):
    with open(path, newline='', encoding='utf-8') as handle:
        return list(csv.reader(handle))


class RevenueReportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        base = Path(self.directory.name)
        self.source = base / 'export.csv'
        self.source.write_bytes(EXPORT.encode('utf-8-sig'))
        self.output = base / 'net.csv'
        self.rejects = base / 'rejects.csv'

    def test_reusable_function(self):
        from examples.revenue_report import net_revenue

        net_revenue(self.source, self.output, self.rejects)
        self.assertEqual(read_csv(self.output), NET)
        self.assertEqual(read_csv(self.rejects), REJECTS)

    def test_cli(self):
        subprocess.run(
            [sys.executable, 'examples/revenue_report_cli.py', str(self.source), str(self.output), str(self.rejects)],
            check=True, cwd=ROOT,
        )
        self.assertEqual(read_csv(self.output), NET)
        self.assertEqual(read_csv(self.rejects), REJECTS)


if __name__ == '__main__':
    unittest.main()
