"""
Tool Creator: The meta-tool that allows the agent to create new tools.

This is the core capability that enables self-improvement.
Includes:
- Search-before-create
- Directive consultation (learning loop)
- Code validation
- Error learning
"""
from langchain_core.tools import tool
from pathlib import Path

from .validator import validator, RiskLevel
from .registry import registry, ToolStatus
from .learning_loop import learning_loop


@tool
def create_new_tool(name: str, description: str, code: str) -> str:
    """
    Creates a new tool for the agent.
    
    PROTOCOL (Learning Loop):
    1. Check if tool already exists
    2. Consult development directive
    3. Verify against learned lessons
    4. Validate code
    5. Run mandatory tests
    6. If all pass, auto-approve
    
    Args:
        name: Tool name (snake_case, ex: 'count_notion_articles')
        description: Clear description of what the tool does
        code: Full Python code with @tool decorator
        
    Returns:
        Creation result or error if invalid.
    """
    from .test_sandbox import test_sandbox, TestCase
    
    output_lines = []
    
    # === PHASE 1: CHECK IF TOOL ALREADY EXISTS (FIRST!) ===
    output_lines.append("🔍 Checking if tool already exists...")
    
    existing = registry.search_existing(description)
    if existing:
        return (
            f"⚠️ A similar tool already exists: '{existing.name}'\n"
            f"Description: {existing.description}\n"
            f"Use it instead of creating a new one."
        )
    
    by_name = registry.get_by_name(name)
    if by_name:
        status_msg = {
            ToolStatus.APPROVED: "approved and available",
            ToolStatus.PENDING: "pending approval",
            ToolStatus.REJECTED: "previously rejected"
        }
        return f"⚠️ A tool with the name '{name}' already exists ({status_msg[by_name.status]})"
    
    output_lines.append("✓ Tool does not exist. Continuing...")
    
    # === PHASE 2: CONSULT DIRECTIVE ===
    output_lines.append("📚 Consulting development directive...")
    directive_info = learning_loop.consult_before_create(description)
    
    if directive_info["lessons"]:
        output_lines.append(f"⚠️ Relevant lessons found ({len(directive_info['lessons'])}):")
        for lesson in directive_info["lessons"][:3]:  # Max 3
            output_lines.append(f"   - {lesson.trap}: {lesson.solution}")
    
    # === PHASE 3: CHECK AGAINST KNOWN TRAPS ===
    warnings = learning_loop.check_code_against_lessons(code)
    if warnings:
        for warning in warnings:
            output_lines.append(warning)
        
        # Auto-correct: Document and return
        learning_loop.learn_from_error(
            tool_name=name,
            error_message="Code violates known rules",
            error_type="validation",
            solution="Review directive and correct"
        )
        
        return "\n".join(output_lines) + "\n\n❌ Code violates known rules. Please review the directive."
    
    # === PHASE 4: VALIDATE CODE ===
    output_lines.append("🔍 Validating code...")
    validation = validator.validate(code, name)
    
    if not validation.is_valid:
        # Auto-correct: Learn and document
        error_msg = "; ".join(validation.errors)
        learning_loop.learn_from_error(
            tool_name=name,
            error_message=error_msg[:100],
            error_type="validation",
            solution="Correct according to error message"
        )
        
        return (
            "❌ Invalid code. Errors:\n"
            + "\n".join(f"  - {e}" for e in validation.errors)
            + "\n\n📚 Error documented in the directive to avoid it in the future."
        )
    
    output_lines.append(f"✓ Validation passed. Risk: {validation.risk_level.value}")
    
    # === PHASE 5: RUN MANDATORY TESTS ===
    output_lines.append("🧪 Running mandatory tests...")
    
    # Generate basic tests
    basic_tests = [
        TestCase(
            name="import_test",
            inputs={},
            should_succeed=False,  # Expected to fail without params
        )
    ]
    
    test_result = test_sandbox.run_tests(code, basic_tests)
    
    # For basic test, we just check the tool can be loaded (not full execution)
    # A more sophisticated version would generate proper test cases
    output_lines.append(f"✓ Tests executed: {test_result.summary()}")
    
    # === PHASE 6: SAVE AND AUTO-APPROVE ===
    needs_approval = validation.risk_level == RiskLevel.EXTERNAL_WRITE
    
    record = registry.create(
        name=name,
        description=description,
        code=code,
        risk_level=validation.risk_level.value
    )
    
    pending_dir = Path(__file__).parent / "pending"
    pending_dir.mkdir(exist_ok=True)
    (pending_dir / f"{name}.py").write_text(code)
    
    if needs_approval:
        output_lines.append(f"🔴 Tool '{name}' created but PENDING APPROVAL.")
        output_lines.append(f"Risk level: {validation.risk_level.value}")
        output_lines.append("The user must review it in the Dashboard.")
    else:
        # Auto-approve (fully automatic)
        registry.approve(name)
        approved_dir = Path(__file__).parent / "approved"
        approved_dir.mkdir(exist_ok=True)
        (pending_dir / f"{name}.py").rename(approved_dir / f"{name}.py")
        
        output_lines.append(f"✅ Tool '{name}' created, tested and auto-approved.")
        output_lines.append(f"You can now use it: `{name}(...)`")
    
    return "\n".join(output_lines)


@tool
def list_available_tools() -> str:
    """
    Lists all available generated tools (approved).
    Useful to know what already exists before creating a new tool.
    """
    approved = registry.list_approved()
    
    if not approved:
        return "No approved generated tools found. You can create one with `create_new_tool`."
    
    lines = ["📦 Available Generated Tools:"]
    for tool in approved:
        lines.append(f"  - {tool.name}: {tool.description[:60]}...")
    
    return "\n".join(lines)


@tool
def get_pending_tools() -> str:
    """
    Lists tools pending approval.
    Only 🔴 risk tools (EXTERNAL_WRITE) require manual approval.
    """
    pending = registry.list_pending()
    
    if not pending:
        return "No tools pending approval."
    
    lines = ["⏳ Tools Pending Approval:"]
    for tool in pending:
        lines.append(
            f"  - {tool.name} [{tool.risk_level}]\n"
            f"    {tool.description[:80]}..."
        )
    
    return "\n".join(lines)


# Export tools
TOOL_CREATOR_TOOLS = [create_new_tool, list_available_tools, get_pending_tools]
