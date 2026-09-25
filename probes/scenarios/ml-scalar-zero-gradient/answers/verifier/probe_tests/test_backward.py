import unittest

from micrograd.engine import Value


class BackwardResetTests(unittest.TestCase):
    def test_repeated_backward_clears_intermediate_gradients(self):
        x = Value(2.0)
        middle = x * x
        result = middle * 3
        result.backward()
        self.assertEqual((x.grad, middle.grad), (12.0, 3.0))
        result.backward()
        self.assertEqual((x.grad, middle.grad), (12.0, 3.0))

    def test_shared_node_and_two_outputs(self):
        x = Value(3.0)
        shared = x * x
        first = shared + x
        second = shared * 2
        first.backward()
        self.assertEqual(x.grad, 7.0)
        second.backward()
        self.assertEqual(x.grad, 12.0)


if __name__ == "__main__":
    unittest.main()
