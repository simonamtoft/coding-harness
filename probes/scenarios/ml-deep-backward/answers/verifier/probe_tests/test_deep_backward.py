import math
import random
import sys
import unittest

from micrograd.engine import Value


def recursive_backward(root):
    """micrograd's original recursive backward, used as the oracle on shallow graphs."""
    topo = []
    visited = set()

    def build_topo(v):
        if v not in visited:
            visited.add(v)
            for child in v._prev:
                build_topo(child)
            topo.append(v)

    build_topo(root)
    root.grad = 1
    for v in reversed(topo):
        v._backward()


def reset_gradients(root):
    pending, seen = [root], set()
    while pending:
        node = pending.pop()
        if node not in seen:
            seen.add(node)
            node.grad = 0
            pending.extend(node._prev)


def random_graph(rng, leaves=4, operations=40):
    nodes = [Value(rng.uniform(-2, 2)) for _ in range(leaves)]
    for _ in range(operations):
        a, b = rng.choice(nodes), rng.choice(nodes)
        op = rng.randrange(5)
        if op == 0:
            out = a + b
        elif op == 1:
            out = a * b
        elif op == 2:
            out = a.relu() + b
        elif op == 3:
            out = (a * 0.5) ** 2 - b
        else:
            out = a * b + a
        nodes.append(out)
    return nodes, sum(rng.sample(nodes[leaves:], 3), Value(0.0))


class DeepBackwardTests(unittest.TestCase):
    def setUp(self):
        self.limit = sys.getrecursionlimit()
        self.set_limit = sys.setrecursionlimit

        def refuse(limit):
            raise AssertionError('backward must not change the recursion limit')

        sys.setrecursionlimit = refuse

    def tearDown(self):
        sys.setrecursionlimit = self.set_limit
        self.set_limit(self.limit)

    def test_chain_deeper_than_the_recursion_limit(self):
        x = Value(1.0)
        scale = Value(1.0)
        y = x
        depth = 100_000
        for _ in range(depth):
            y = y * scale + 0.0
        y.backward()
        self.assertEqual(x.grad, 1.0)
        self.assertEqual(scale.grad, float(depth))
        self.assertEqual(sys.getrecursionlimit(), self.limit)

    def test_matches_original_gradients_on_shared_graphs(self):
        rng = random.Random(20261006)
        for case in range(200):
            nodes, out = random_graph(rng)
            recursive_backward(out)
            expected = [node.grad for node in nodes]
            reset_gradients(out)
            out.backward()
            for index, (got, want) in enumerate(zip([node.grad for node in nodes], expected)):
                self.assertTrue(math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-9),
                                f'case {case}, node {index}: got {got}, expected {want}')

    def test_repeated_backward_keeps_accumulation_semantics(self):
        def graph():
            x = Value(3.0)
            shared = x * x
            return x, shared, shared + shared * x

        x, shared, out = graph()
        recursive_backward(out)
        recursive_backward(out)
        expected = (x.grad, shared.grad)
        x, shared, out = graph()
        out.backward()
        out.backward()
        self.assertEqual((x.grad, shared.grad), expected)


if __name__ == '__main__':
    unittest.main()
