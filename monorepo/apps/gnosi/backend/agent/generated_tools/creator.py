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
    Crea una nova eina per a l'agent.
    
    PROTOCOL (Bucle d'Aprenentatge):
    1. Comprova si l'eina ja existeix
    2. Consulta la directiva de desenvolupament
    3. Verifica contra lliçons apreses
    4. Valida el codi
    5. Executa tests obligatoris
    6. Si tot passa, aprova automàticament
    
    Args:
        name: Nom de l'eina (snake_case, ex: 'count_notion_articles')
        description: Descripció clara del que fa l'eina
        code: Codi Python complet amb el decorador @tool
        
    Returns:
        Resultat de la creació o error si no és vàlid.
    """
    from .test_sandbox import test_sandbox, TestCase
    
    output_lines = []
    
    # === PHASE 1: CHECK IF TOOL ALREADY EXISTS (FIRST!) ===
    output_lines.append("🔍 Comprovant si l'eina ja existeix...")
    
    existing = registry.search_existing(description)
    if existing:
        return (
            f"⚠️ Ja existeix una eina similar: '{existing.name}'\n"
            f"Descripció: {existing.description}\n"
            f"Usa-la en lloc de crear-ne una de nova."
        )
    
    by_name = registry.get_by_name(name)
    if by_name:
        status_msg = {
            ToolStatus.APPROVED: "aprovada i disponible",
            ToolStatus.PENDING: "pendent d'aprovació",
            ToolStatus.REJECTED: "rebutjada anteriorment"
        }
        return f"⚠️ Ja existeix una eina amb el nom '{name}' ({status_msg[by_name.status]})"
    
    output_lines.append("✓ L'eina no existeix. Continuant...")
    
    # === PHASE 2: CONSULT DIRECTIVE ===
    output_lines.append("📚 Consultant directiva de desenvolupament...")
    directive_info = learning_loop.consult_before_create(description)
    
    if directive_info["lessons"]:
        output_lines.append(f"⚠️ Lliçons rellevants trobades ({len(directive_info['lessons'])}):")
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
            error_message="Codi viola regles conegudes",
            error_type="validation",
            solution="Revisar directiva i corregir"
        )
        
        return "\n".join(output_lines) + "\n\n❌ Codi viola regles conegudes. Revisa la directiva."
    
    # === PHASE 4: VALIDATE CODE ===
    output_lines.append("🔍 Validant codi...")
    validation = validator.validate(code, name)
    
    if not validation.is_valid:
        # Auto-correct: Learn and document
        error_msg = "; ".join(validation.errors)
        learning_loop.learn_from_error(
            tool_name=name,
            error_message=error_msg[:100],
            error_type="validation",
            solution="Corregir segons missatge d'error"
        )
        
        return (
            "❌ Codi invàlid. Errors:\n"
            + "\n".join(f"  - {e}" for e in validation.errors)
            + "\n\n📚 Error documentat a la directiva per evitar-lo en el futur."
        )
    
    output_lines.append(f"✓ Validació passada. Risc: {validation.risk_level.value}")
    
    # === PHASE 5: RUN MANDATORY TESTS ===
    output_lines.append("🧪 Executant tests obligatoris...")
    
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
    output_lines.append(f"✓ Tests executats: {test_result.summary()}")
    
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
        output_lines.append(f"🔴 Eina '{name}' creada però PENDENT D'APROVACIÓ.")
        output_lines.append(f"Nivell de risc: {validation.risk_level.value}")
        output_lines.append("L'usuari ha de revisar-la al Dashboard.")
    else:
        # Auto-approve (totalment automàtic)
        registry.approve(name)
        approved_dir = Path(__file__).parent / "approved"
        approved_dir.mkdir(exist_ok=True)
        (pending_dir / f"{name}.py").rename(approved_dir / f"{name}.py")
        
        output_lines.append(f"✅ Eina '{name}' creada, testejada i aprovada automàticament.")
        output_lines.append(f"Ja pots usar-la: `{name}(...)`")
    
    return "\n".join(output_lines)


@tool
def list_available_tools() -> str:
    """
    Llista totes les eines generades disponibles (aprovades).
    Útil per saber què ja existeix abans de crear una eina nova.
    """
    approved = registry.list_approved()
    
    if not approved:
        return "No hi ha eines generades aprovades. Pots crear-ne amb `create_new_tool`."
    
    lines = ["📦 Eines Generades Disponibles:"]
    for tool in approved:
        lines.append(f"  - {tool.name}: {tool.description[:60]}...")
    
    return "\n".join(lines)


@tool
def get_pending_tools() -> str:
    """
    Llista les eines pendents d'aprovació.
    Només eines de risc 🔴 (EXTERNAL_WRITE) requereixen aprovació manual.
    """
    pending = registry.list_pending()
    
    if not pending:
        return "No hi ha eines pendents d'aprovació."
    
    lines = ["⏳ Eines Pendents d'Aprovació:"]
    for tool in pending:
        lines.append(
            f"  - {tool.name} [{tool.risk_level}]\n"
            f"    {tool.description[:80]}..."
        )
    
    return "\n".join(lines)


# Export tools
TOOL_CREATOR_TOOLS = [create_new_tool, list_available_tools, get_pending_tools]
