import unittest

from micrograd.engine import Value


class GradientQueryTests(unittest.TestCase):
    def test_shared_graph_and_existing_gradients(self):
        x = Value(3.0)
        y = Value(-2.0)
        shared = x * y
        out = shared + shared * x
        x.grad, y.grad, shared.grad, out.grad = 41, 42, 43, 44
        self.assertEqual(out.gradients([x, y]), (-14.0, 12.0))
        self.assertEqual((x.grad, y.grad, shared.grad, out.grad), (41, 42, 43, 44))
        self.assertEqual(out.gradients([x, y]), (-14.0, 12.0))

    def test_unused_input(self):
        x = Value(2.0)
        result = x * x
        self.assertEqual(result.gradients([x, Value(99.0)]), (4.0, 0.0))
        self.assertEqual(x.grad, 0)


if __name__ == '__main__':
    unittest.main()
