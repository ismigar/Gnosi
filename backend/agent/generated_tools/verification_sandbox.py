"""Run generated-tool tests in a short-lived subprocess sandbox."""

from __future__ import annotations

# This is a production sandbox service, not a pytest module.
__test__ = False

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from backend.agent.generated_tools.sandbox_runner import run_process


@dataclass
class TestCase:
    """A single test case for a tool."""

    name: str
    inputs: Dict[str, object]
    expected_contains: Optional[str] = None
    should_not_contain: Optional[str] = None
    should_succeed: bool = True


@dataclass
class TestResult:
    """Result of running a test case."""

    test_name: str
    passed: bool
    output: str
    error: Optional[str] = None
    duration_ms: float = 0.0


@dataclass
class SandboxResult:
    """Result of running all tests in the subprocess sandbox."""

    success: bool
    test_results: List[TestResult] = field(default_factory=list)
    total_tests: int = 0
    passed_tests: int = 0
    errors: List[str] = field(default_factory=list)

    def summary(self) -> str:
        if self.success:
            return f"✅ {self.passed_tests}/{self.total_tests} tests passats"
        return (
            f"❌ {self.passed_tests}/{self.total_tests} tests passats. Errors: {len(self.errors)}"
        )


class TestSandbox:
    """Validate and invoke generated tools outside the API process."""

    DEFAULT_TIMEOUT = 10

    def __init__(self, timeout: int = DEFAULT_TIMEOUT):
        self.timeout = max(2, min(int(timeout), 120))

    def run_tests(self, tool_code: str, test_cases: List[TestCase]) -> SandboxResult:
        result = SandboxResult(success=True, total_tests=len(test_cases))
        try:
            run_process(tool_code, action="describe", timeout_seconds=self.timeout)
        except Exception as error:  # noqa: BLE001
            result.success = False
            result.errors.append(f"Error loading the code: {error}")
            return result

        for test_case in test_cases:
            test_result = self._run_single_test(tool_code, test_case)
            result.test_results.append(test_result)
            if test_result.passed:
                result.passed_tests += 1
            else:
                result.success = False
                if test_result.error:
                    result.errors.append(f"{test_case.name}: {test_result.error}")
        return result

    def _run_single_test(self, tool_code: str, test_case: TestCase) -> TestResult:
        result = TestResult(test_name=test_case.name, passed=False, output="")
        try:
            payload = run_process(
                tool_code,
                action="invoke",
                arguments=test_case.inputs,
                timeout_seconds=self.timeout,
            )
            error = None
            output = payload.get("result")
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"
            output = None

        if error and test_case.should_succeed:
            result.error = error
            return result
        if not test_case.should_succeed and not error:
            result.error = "An error was expected, but none occurred"
            return result

        result.output = str(output) if output is not None else ""
        if test_case.expected_contains and test_case.expected_contains not in result.output:
            result.error = f"The result does not contain '{test_case.expected_contains}'"
            return result
        if test_case.should_not_contain and test_case.should_not_contain in result.output:
            result.error = f"The result contains '{test_case.should_not_contain}' but should not"
            return result
        result.passed = True
        return result

    def generate_basic_tests(self, tool_name: str, tool_description: str) -> List[TestCase]:
        return [TestCase(name=f"{tool_name}_basic", inputs={}, should_succeed=False)]


test_sandbox = TestSandbox()
