import unittest

from micrograd.engine import Value


class MultiplyGradientTests(unittest.TestCase):
    def test_negative_multiplier(self):
        x = Value(2.0)
        y = Value(-3.0)
        (x * y).backward()
        self.assertEqual(x.grad, -3.0)
        self.assertEqual(y.grad, 2.0)

    def test_shared_operand(self):
        x = Value(-4.0)
        (x * x).backward()
        self.assertEqual(x.grad, -8.0)


if __name__ == "__main__":
    unittest.main()
