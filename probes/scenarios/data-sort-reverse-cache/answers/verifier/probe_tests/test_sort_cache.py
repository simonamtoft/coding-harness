import os
import subprocess
import tempfile
import unittest

import petl as etl
from petl.util.base import Table


class CountingTable(Table):
    """A source table that records how often it is read."""

    def __init__(self, rows):
        self.rows = rows
        self.reads = 0

    def __iter__(self):
        self.reads += 1
        return iter(self.rows)


def ledger(size=60):
    # Many ties on amount, with a sequence number to observe stability.
    rows = [('seq', 'region', 'amount')]
    for seq in range(size):
        rows.append((seq, 'NSEW'[seq % 4], (seq * 37) % 11))
    return rows


def expected(rows, fields, reverse):
    header = rows[0]
    indices = [header.index(field) for field in fields]
    body = sorted(rows[1:], key=lambda row: tuple(row[i] for i in indices), reverse=reverse)
    return [tuple(header)] + [tuple(row) for row in body]


class SortCacheTests(unittest.TestCase):
    def assert_sorted_twice(self, fields, reverse, buffersize):
        rows = ledger()
        source = CountingTable(rows)
        key = fields[0] if len(fields) == 1 else tuple(fields)
        table = etl.sort(source, key, reverse=reverse, buffersize=buffersize)
        want = expected(rows, fields, reverse)
        label = f'{fields} reverse={reverse} buffersize={buffersize}'
        self.assertEqual(list(table), want, f'first iteration, {label}')
        reads = source.reads
        self.assertEqual(list(table), want, f'second iteration (cached), {label}')
        self.assertEqual(list(table), want, f'third iteration (cached), {label}')
        self.assertEqual(source.reads, reads, f'later iterations must reuse the sort cache, {label}')

    def test_descending_sort_larger_than_buffer(self):
        for buffersize in (7, 13, 59):
            self.assert_sorted_twice(['amount'], True, buffersize)
            self.assert_sorted_twice(['region', 'amount'], True, buffersize)

    def test_ascending_sort_larger_than_buffer(self):
        for buffersize in (7, 13):
            self.assert_sorted_twice(['amount'], False, buffersize)

    def test_sorts_within_buffer(self):
        self.assert_sorted_twice(['amount'], True, 1000)

    def test_written_csv_after_counting(self):
        rows = ledger()
        table = etl.sort(rows, 'amount', reverse=True, buffersize=9)
        self.assertEqual(etl.nrows(table), len(rows) - 1)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'sorted.csv')
            etl.tocsv(table, path)
            written = etl.convert(etl.fromcsv(path), ('seq', 'amount'), int)
            self.assertEqual(list(written), expected(rows, ['amount'], True))

    def test_fix_stays_in_the_sort_module(self):
        changed = subprocess.run(['git', 'diff', '--name-only', 'HEAD'], capture_output=True, text=True, check=True).stdout.split()
        outside = [path for path in changed if path != 'petl/transform/sorts.py' and not path.startswith('petl/test/')]
        self.assertEqual(outside, [], 'only petl/transform/sorts.py and tests under petl/test/ may change')


if __name__ == '__main__':
    unittest.main()
