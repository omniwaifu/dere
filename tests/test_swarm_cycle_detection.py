"""Tests for swarm dependency cycle detection and DAG utilities."""

from __future__ import annotations

from dere_daemon.swarm.coordinator import detect_dependency_cycle
from dere_daemon.swarm.models import AgentSpec, DependencySpec


def make_agent(name: str, depends_on: list[str] | None = None) -> AgentSpec:
    """Create a minimal AgentSpec for testing."""
    deps = None
    if depends_on:
        deps = [DependencySpec(agent=d) for d in depends_on]
    return AgentSpec(name=name, depends_on=deps)


class TestCycleDetection:
    def test_no_dependencies(self):
        agents = [make_agent("a"), make_agent("b"), make_agent("c")]
        assert detect_dependency_cycle(agents) is None

    def test_linear_chain(self):
        agents = [
            make_agent("a"),
            make_agent("b", ["a"]),
            make_agent("c", ["b"]),
        ]
        assert detect_dependency_cycle(agents) is None

    def test_fan_in(self):
        agents = [
            make_agent("a"),
            make_agent("b"),
            make_agent("c", ["a", "b"]),
        ]
        assert detect_dependency_cycle(agents) is None

    def test_fan_out(self):
        agents = [
            make_agent("a"),
            make_agent("b", ["a"]),
            make_agent("c", ["a"]),
        ]
        assert detect_dependency_cycle(agents) is None

    def test_simple_cycle(self):
        agents = [
            make_agent("a", ["b"]),
            make_agent("b", ["a"]),
        ]
        cycle = detect_dependency_cycle(agents)
        assert cycle is not None
        assert len(cycle) == 3  # a -> b -> a
        assert cycle[0] == cycle[-1]  # Starts and ends with same node

    def test_self_cycle(self):
        agents = [make_agent("a", ["a"])]
        cycle = detect_dependency_cycle(agents)
        assert cycle is not None
        assert cycle == ["a", "a"]

    def test_three_node_cycle(self):
        agents = [
            make_agent("a", ["c"]),
            make_agent("b", ["a"]),
            make_agent("c", ["b"]),
        ]
        cycle = detect_dependency_cycle(agents)
        assert cycle is not None
        assert len(cycle) == 4  # a -> c -> b -> a (or some rotation)
        assert cycle[0] == cycle[-1]

    def test_cycle_with_independent_agents(self):
        agents = [
            make_agent("independent"),
            make_agent("a", ["b"]),
            make_agent("b", ["a"]),
            make_agent("also_independent"),
        ]
        cycle = detect_dependency_cycle(agents)
        assert cycle is not None
        assert "independent" not in cycle
        assert "also_independent" not in cycle

    def test_diamond_no_cycle(self):
        agents = [
            make_agent("a"),
            make_agent("b", ["a"]),
            make_agent("c", ["a"]),
            make_agent("d", ["b", "c"]),
        ]
        assert detect_dependency_cycle(agents) is None

    def test_unknown_dependency_ignored(self):
        agents = [
            make_agent("a", ["nonexistent"]),
            make_agent("b", ["a"]),
        ]
        assert detect_dependency_cycle(agents) is None
