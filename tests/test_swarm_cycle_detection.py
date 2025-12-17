"""Tests for swarm dependency cycle detection, DAG utilities, and conditions."""

from __future__ import annotations

from dere_daemon.swarm.coordinator import detect_dependency_cycle, evaluate_condition
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


class TestConditionEvaluation:
    def test_simple_equality(self):
        output = '{"risk_level": "high"}'
        result, error = evaluate_condition('output.risk_level == "high"', output)
        assert error is None
        assert result is True

    def test_simple_inequality(self):
        output = '{"risk_level": "low"}'
        result, error = evaluate_condition('output.risk_level == "high"', output)
        assert error is None
        assert result is False

    def test_numeric_comparison(self):
        output = '{"score": 85}'
        result, error = evaluate_condition("output.score >= 80", output)
        assert error is None
        assert result is True

    def test_len_function(self):
        output = '{"issues": [1, 2, 3]}'
        result, error = evaluate_condition("len(output.issues) > 0", output)
        assert error is None
        assert result is True

    def test_empty_list(self):
        output = '{"issues": []}'
        result, error = evaluate_condition("len(output.issues) > 0", output)
        assert error is None
        assert result is False

    def test_bracket_access(self):
        output = '{"data": {"nested": "value"}}'
        result, error = evaluate_condition('output["data"]["nested"] == "value"', output)
        assert error is None
        assert result is True

    def test_json_in_code_block(self):
        output = 'Here is the result:\n```json\n{"status": "success"}\n```\nDone!'
        result, error = evaluate_condition('output.status == "success"', output)
        assert error is None
        assert result is True

    def test_non_json_output(self):
        output = "Just plain text output"
        result, error = evaluate_condition('output.text is not None', output)
        assert error is None
        assert result is True

    def test_none_output(self):
        result, error = evaluate_condition('output.foo == "bar"', None)
        assert error is not None
        assert "no output" in error.lower()

    def test_missing_field(self):
        output = '{"foo": "bar"}'
        result, error = evaluate_condition("output.nonexistent == 42", output)
        assert error is None
        assert result is False  # None == 42 is False

    def test_boolean_condition(self):
        output = '{"enabled": true}'
        result, error = evaluate_condition("output.enabled", output)
        assert error is None
        assert result is True

    def test_any_function(self):
        output = '{"values": [1, 2, 3, 10]}'
        result, error = evaluate_condition("any(v > 5 for v in output.values)", output)
        assert error is None
        assert result is True

    def test_invalid_syntax(self):
        output = '{"foo": "bar"}'
        result, error = evaluate_condition("output.foo ==== bar", output)
        assert error is not None
        assert "error" in error.lower()
