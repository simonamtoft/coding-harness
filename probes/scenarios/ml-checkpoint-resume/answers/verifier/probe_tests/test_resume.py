import json
import math
import os
import random
import tempfile
import unittest

from micrograd.engine import Value
from micrograd.nn import MLP

from micrograd.checkpoint import load_checkpoint, save_checkpoint
from micrograd.optim import SGD

DATA = [([0.5, -1.0], 1.0), ([-0.3, 0.8], -1.0), ([1.2, 0.1], 0.5), ([-0.7, -0.4], -0.5)]
HYPER = dict(lr=0.05, momentum=0.9, weight_decay=1e-3)


def model(seed):
    random.seed(seed)
    return MLP(2, [4, 4, 1])


def train(net, optimizer, steps):
    for _ in range(steps):
        loss = sum(((net(x) - y) ** 2 for x, y in DATA), Value(0.0))
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()


def values(net):
    return [p.data for p in net.parameters()]


class StateDictTests(unittest.TestCase):
    def test_round_trip_and_size_check(self):
        source, target = model(1), model(2)
        target.load_state_dict(source.state_dict())
        self.assertEqual(values(target), values(source))
        self.assertEqual(source.state_dict(), values(source))
        with self.assertRaises(ValueError):
            target.load_state_dict(source.state_dict()[:-1])


class SGDTests(unittest.TestCase):
    def test_matches_pytorch_sgd_semantics(self):
        p = Value(1.0)
        optimizer = SGD([p], lr=0.1, momentum=0.5, weight_decay=0.2)
        expected, buf = 1.0, None
        for grad in [2.0, -1.0, 0.5]:
            optimizer.zero_grad()
            self.assertEqual(p.grad, 0)
            p.grad = grad
            optimizer.step()
            g = grad + 0.2 * expected
            buf = g if buf is None else 0.5 * buf + g
            expected -= 0.1 * buf
            self.assertAlmostEqual(p.data, expected, places=12)

    def test_plain_sgd(self):
        p = Value(1.0)
        optimizer = SGD([p], lr=0.25)
        p.grad = 2.0
        optimizer.step()
        self.assertEqual(p.data, 0.5)


class ResumeTests(unittest.TestCase):
    def test_resume_continues_exactly(self):
        straight = model(7)
        train(straight, SGD(straight.parameters(), **HYPER), 6)

        first = model(7)
        optimizer = SGD(first.parameters(), **HYPER)
        train(first, optimizer, 3)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'checkpoint.json')
            save_checkpoint(path, first, optimizer, 3)
            with open(path, encoding='utf-8') as handle:
                json.load(handle)
            resumed = model(99)
            resumed_optimizer = SGD(resumed.parameters(), **HYPER)
            self.assertEqual(load_checkpoint(path, resumed, resumed_optimizer), 3)
        train(resumed, resumed_optimizer, 3)
        # Backward order follows set iteration, so gradient sums can differ in the last bits.
        for index, (got, want) in enumerate(zip(values(resumed), values(straight))):
            self.assertTrue(math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-12), f'parameter {index}: {got} != {want}')


if __name__ == '__main__':
    unittest.main()
