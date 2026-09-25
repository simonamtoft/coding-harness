import unittest

from mcp.server.caching import CacheHint


class CacheHintTtlTests(unittest.TestCase):
    def test_rejects_non_integer_ttl(self):
        for value in (True, False, 0.5, '10', None):
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                CacheHint(ttl_ms=value)

    def test_valid_values_and_scope(self):
        self.assertEqual(CacheHint().ttl_ms, 0)
        self.assertEqual(CacheHint(ttl_ms=200, scope='public').scope, 'public')
        with self.assertRaises((ValueError, TypeError)):
            CacheHint(ttl_ms=-1)


if __name__ == '__main__':
    unittest.main()
