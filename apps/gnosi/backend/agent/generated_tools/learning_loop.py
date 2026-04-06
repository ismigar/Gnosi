"""
Learning Loop: Auto-correction and knowledge preservation for tool development.

When a tool fails:
1. Diagnose the error
2. Update the directive with the lesson learned
3. Apply the fix
4. Verify

This ensures the agent never makes the same mistake twice.
"""
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass

from backend.agent.directive_tools import read_directive, update_directive, list_directives


@dataclass
class LessonLearned:
    """A lesson extracted from an error."""
    date: str
    trap: str
    solution: str
    error_type: str


class LearningLoop:
    """
    Manages the learning cycle for tool development.
    Ensures directives are consulted before creation and updated after errors.
    """
    
    TOOL_DIRECTIVE = "tool_development"
    
    def __init__(self):
        self.lessons_cache: List[LessonLearned] = []
        self._load_existing_lessons()
    
    def _load_existing_lessons(self):
        """Load existing lessons from the directive."""
        content = read_directive.invoke({"topic": self.TOOL_DIRECTIVE})
        if "Error:" not in content:
            # Parse existing traps table
            self.lessons_cache = self._parse_traps_table(content)
    
    def _parse_traps_table(self, content: str) -> List[LessonLearned]:
        """Extract lessons from the Trampes Descobertes table."""
        lessons = []
        # Match table rows: | date | trap | solution |
        pattern = r'\| (\d{4}-\d{2}-\d{2}) \| (.+?) \| (.+?) \|'
        matches = re.findall(pattern, content)
        for date, trap, solution in matches:
            if date != "Data":  # Skip header
                lessons.append(LessonLearned(
                    date=date,
                    trap=trap.strip(),
                    solution=solution.strip(),
                    error_type="unknown"
                ))
        return lessons
    
    def consult_before_create(self, tool_description: str) -> Dict:
        """
        Consult directive before creating a new tool.
        Returns relevant lessons and patterns.
        """
        content = read_directive.invoke({"topic": self.TOOL_DIRECTIVE})
        
        if "Error:" in content:
            # Directive doesn't exist, create it
            return {
                "status": "no_directive",
                "message": "No hi ha directiva. Es recomana crear-ne una.",
                "lessons": [],
                "patterns": []
            }
        
        # Extract relevant lessons based on description keywords
        relevant_lessons = []
        keywords = set(tool_description.lower().split())
        
        for lesson in self.lessons_cache:
            lesson_words = set(lesson.trap.lower().split())
            if keywords & lesson_words:  # Any overlap
                relevant_lessons.append(lesson)
        
        # Extract patterns section
        patterns = self._extract_section(content, "Patrons Recomanats")
        restrictions = self._extract_section(content, "Restriccions Conegudes")
        
        return {
            "status": "found",
            "lessons": relevant_lessons,
            "patterns": patterns,
            "restrictions": restrictions,
            "message": f"Trobades {len(relevant_lessons)} lliçons rellevants."
        }
    
    def _extract_section(self, content: str, section_name: str) -> str:
        """Extract content of a specific section."""
        pattern = rf'## {section_name}\n(.*?)(?=\n## |\Z)'
        match = re.search(pattern, content, re.DOTALL)
        return match.group(1).strip() if match else ""
    
    def learn_from_error(
        self,
        tool_name: str,
        error_message: str,
        error_type: str,
        solution: str
    ) -> Tuple[bool, str]:
        """
        Learn from an error and update the directive.
        
        Args:
            tool_name: Name of the tool that failed
            error_message: The error message
            error_type: Type of error (validation, runtime, etc.)
            solution: How to fix it
        
        Returns:
            Tuple of (success, message)
        """
        # Create new lesson
        lesson = LessonLearned(
            date=datetime.now().strftime("%Y-%m-%d"),
            trap=f"{error_type}: {error_message[:50]}...",
            solution=solution,
            error_type=error_type
        )
        
        # Load current directive
        content = read_directive.invoke({"topic": self.TOOL_DIRECTIVE})
        
        if "Error:" in content:
            return (False, "No es pot actualitzar: directiva no trobada")
        
        # Find the traps table and add new row
        table_pattern = r'(\| Data \| Trampa \| Solució \|\n\|------|--------|---------|)'
        new_row = f"\n| {lesson.date} | {lesson.trap} | {lesson.solution} |"
        
        if re.search(table_pattern, content):
            # Add after the header row
            updated = re.sub(
                table_pattern,
                r'\1' + new_row,
                content
            )
        else:
            # Table doesn't exist, add at the end
            updated = content + f"\n\n## Trampes Descobertes\n\n| Data | Trampa | Solució |\n|------|--------|---------|{new_row}\n"
        
        # Update timestamp
        updated = re.sub(
            r'\*Última actualització:.*\*',
            f'*Última actualització: {datetime.now().strftime("%Y-%m-%d")}*',
            updated
        )
        
        # Save
        result = update_directive.invoke({"topic": self.TOOL_DIRECTIVE, "content": updated})
        
        if "Successfully" in result:
            self.lessons_cache.append(lesson)
            return (True, f"📚 Lliçó apresa i documentada: {lesson.trap}")
        
        return (False, f"Error guardant lliçó: {result}")
    
    def check_code_against_lessons(self, code: str) -> List[str]:
        """
        Check if code violates any known lessons/traps.
        Returns list of warnings.
        """
        warnings = []
        
        # Check against known traps
        trap_patterns = {
            "subprocess": "No usar subprocess (risc de seguretat)",
            "requests.": "No usar requests directament, usar MCP client",
            "eval(": "No usar eval() (execució arbitrària)",
            "exec(": "No usar exec() (execució arbitrària)",
            "__import__": "No usar __import__() (imports dinàmics)",
        }
        
        for pattern, warning in trap_patterns.items():
            if pattern in code:
                warnings.append(f"⚠️ {warning}")
        
        # Check lessons from cache
        for lesson in self.lessons_cache:
            # Simple keyword matching
            if any(word in code.lower() for word in lesson.trap.lower().split()):
                warnings.append(f"📚 Possible trampa: {lesson.trap} → {lesson.solution}")
        
        return warnings
    
    def get_development_checklist(self) -> str:
        """
        Return a checklist for tool development based on the directive.
        """
        content = read_directive.invoke({"topic": self.TOOL_DIRECTIVE})
        
        if "Error:" in content:
            return "No hi ha directiva disponible."
        
        steps = self._extract_section(content, "Passos Obligatoris")
        return f"📋 Checklist de desenvolupament:\n{steps}"


# Singleton instance
learning_loop = LearningLoop()
