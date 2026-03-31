"""
Test Sandbox: Safe execution environment for testing new tools.

Executes tool code in an isolated environment with:
- Timeout protection
- Output capture
- Error handling
"""
import sys
import io
import traceback
from typing import Optional, Dict, List, Any, Tuple
from dataclasses import dataclass, field
from contextlib import redirect_stdout, redirect_stderr
import importlib.util
import threading


@dataclass
class TestCase:
    """A single test case for a tool."""
    name: str
    inputs: Dict[str, Any]
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
    """Result of running all tests in sandbox."""
    success: bool
    test_results: List[TestResult] = field(default_factory=list)
    total_tests: int = 0
    passed_tests: int = 0
    errors: List[str] = field(default_factory=list)
    
    def summary(self) -> str:
        if self.success:
            return f"✅ {self.passed_tests}/{self.total_tests} tests passats"
        else:
            return f"❌ {self.passed_tests}/{self.total_tests} tests passats. Errors: {len(self.errors)}"


class TestSandbox:
    """
    Executes tool code in a safe sandbox environment.
    """
    
    DEFAULT_TIMEOUT = 10  # seconds
    
    def __init__(self, timeout: int = DEFAULT_TIMEOUT):
        self.timeout = timeout
    
    def run_tests(
        self, 
        tool_code: str, 
        test_cases: List[TestCase]
    ) -> SandboxResult:
        """
        Run a series of test cases against tool code.
        
        Args:
            tool_code: The Python code defining the tool
            test_cases: List of test cases to run
        
        Returns:
            SandboxResult with all test outcomes
        """
        result = SandboxResult(success=True, total_tests=len(test_cases))
        
        # First, try to load the tool
        try:
            tool_func = self._load_tool(tool_code)
            if tool_func is None:
                result.success = False
                result.errors.append("No s'ha pogut trobar la funció @tool al codi")
                return result
        except Exception as e:
            result.success = False
            result.errors.append(f"Error carregant el codi: {str(e)}")
            return result
        
        # Run each test case
        for test_case in test_cases:
            test_result = self._run_single_test(tool_func, test_case)
            result.test_results.append(test_result)
            
            if test_result.passed:
                result.passed_tests += 1
            else:
                result.success = False
                if test_result.error:
                    result.errors.append(f"{test_case.name}: {test_result.error}")
        
        return result
    
    def _load_tool(self, code: str):
        """
        Dynamically load tool code and return the tool function.
        """
        # Create a temporary module
        module_name = "sandbox_test_module"
        spec = importlib.util.spec_from_loader(module_name, loader=None)
        if spec is None:
            return None
        
        module = importlib.util.module_from_spec(spec)
        
        # Execute with limited globals
        safe_globals = {
            '__builtins__': {
                'str': str, 'int': int, 'float': float, 'bool': bool,
                'list': list, 'dict': dict, 'tuple': tuple, 'set': set,
                'len': len, 'range': range, 'enumerate': enumerate,
                'print': print, 'isinstance': isinstance, 'type': type,
                'Exception': Exception, 'ValueError': ValueError,
                'TypeError': TypeError, 'KeyError': KeyError,
            },
            '__name__': module_name,
        }
        
        try:
            exec(code, safe_globals, module.__dict__)
        except Exception as e:
            raise RuntimeError(f"Error executant codi: {e}")
        
        # Find the tool function
        from langchain_core.tools import BaseTool
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if isinstance(attr, BaseTool):
                return attr
            if callable(attr) and hasattr(attr, 'name'):
                return attr
        
        return None
    
    def _run_single_test(self, tool_func, test_case: TestCase) -> TestResult:
        """Run a single test case with timeout."""
        result = TestResult(test_name=test_case.name, passed=False, output="")
        
        # Capture output
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        output = None
        error = None
        
        def run_test():
            nonlocal output, error
            try:
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    # Call the tool
                    if hasattr(tool_func, 'invoke'):
                        output = tool_func.invoke(test_case.inputs)
                    elif callable(tool_func):
                        output = tool_func(**test_case.inputs)
                    else:
                        output = str(tool_func)
            except Exception as e:
                error = f"{type(e).__name__}: {str(e)}"
        
        # Run with timeout
        thread = threading.Thread(target=run_test)
        thread.start()
        thread.join(timeout=self.timeout)
        
        if thread.is_alive():
            result.error = f"Timeout després de {self.timeout}s"
            return result
        
        # Evaluate results
        result.output = str(output) if output else ""
        
        if error and test_case.should_succeed:
            result.error = error
            return result
        
        if not test_case.should_succeed and not error:
            result.error = "S'esperava un error però no n'hi ha hagut"
            return result
        
        if test_case.expected_contains:
            if test_case.expected_contains not in result.output:
                result.error = f"El resultat no conté '{test_case.expected_contains}'"
                return result
        
        if test_case.should_not_contain:
            if test_case.should_not_contain in result.output:
                result.error = f"El resultat conté '{test_case.should_not_contain}' (no hauria)"
                return result
        
        result.passed = True
        return result
    
    def generate_basic_tests(self, tool_name: str, tool_description: str) -> List[TestCase]:
        """
        Generate basic test cases based on tool description.
        """
        tests = []
        
        # Test 1: Basic invocation (empty/minimal input)
        tests.append(TestCase(
            name=f"{tool_name}_basic",
            inputs={},
            should_succeed=False  # Most tools need params
        ))
        
        # More sophisticated test generation could use LLM
        return tests


# Singleton instance
test_sandbox = TestSandbox()
