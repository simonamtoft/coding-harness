import csv
import tempfile
import unittest
from pathlib import Path

import petl as etl


class CsvHeaderTests(unittest.TestCase):
    def test_both_modes_keep_all_data_rows(self):
        table = [('name', 'count'), ('first', '1'), ('second', '2')]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rows.csv'
            etl.tocsv(table, path, write_header=False)
            with path.open(newline='') as handle:
                self.assertEqual(list(csv.reader(handle)), [['first', '1'], ['second', '2']])
            etl.tocsv(table, path, write_header=True)
            with path.open(newline='') as handle:
                self.assertEqual(list(csv.reader(handle)), [['name', 'count'], ['first', '1'], ['second', '2']])


if __name__ == '__main__':
    unittest.main()
