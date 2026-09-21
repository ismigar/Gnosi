"""Portable learning metadata and its bounded runtime instruction projection."""

from backend.models.agent_skills import SkillDescriptor
from backend.services.agent_learning_models import LearnedSkill


def learned_skill(descriptor: SkillDescriptor) -> LearnedSkill:
    learning = descriptor.metadata.get("learning")
    if isinstance(learning, dict):
        return LearnedSkill.model_validate({
            **learning, "name": descriptor.name, "description": descriptor.description,
            "instructions": descriptor.instructions, "tool_ids": descriptor.tool_ids,
        })
    return LearnedSkill(
        name=descriptor.name, description=descriptor.description,
        instructions=descriptor.instructions or descriptor.description or descriptor.name,
        tool_ids=descriptor.tool_ids,
        criteria=["Complete the stated task with verifiable evidence."],
    )


def runtime_instructions(descriptor: SkillDescriptor) -> str:
    if not isinstance(descriptor.metadata.get("learning"), dict):
        return descriptor.instructions
    try:
        skill = LearnedSkill.model_validate(descriptor.metadata["learning"])
    except ValueError:
        # Legacy user metadata may use this key without the learning schema.
        return descriptor.instructions
    criteria = "\n".join(f"- {item}" for item in skill.criteria)
    references = "\n\n".join(f"### {item.name}\n{item.content}" for item in skill.resources)
    examples = "\n\n".join(
        f"### {item.name}\nInput: {item.input}\nExpected: {item.expected}" for item in skill.examples
    )
    return (
        f"{descriptor.instructions}\n\n## Acceptance criteria\n{criteria}"
        f"\n\n## Reference templates\n{references}\n\n## Examples\n{examples}"
    )
