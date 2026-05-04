# pipeline/brain/orchestrator.py
import json
import os
import subprocess
import time
from pathlib import Path
from datetime import datetime
import sys

# Add project root to path for imports
# Add Gnosi root for imports
gnosi_root = Path(__file__).parent.parent.parent
sys.path.append(str(gnosi_root))

from pipeline.ai_client import call_ai_with_fallback
from backend.config.logger_config import setup_logging, get_logger

# Configuration
TEAM_BASE = Path("/Users/ismaelgarciafernandez/Projectes/.antigravity/team")
TASKS_FILE = TEAM_BASE / "tasks.json"
LOCKS_DIR = TEAM_BASE / "locks"
MAILBOX_DIR = TEAM_BASE / "mailbox"
LOGS_FILE = Path("/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/pipeline/.tmp/orchestrator.log")

setup_logging("INFO")
log = get_logger("orchestrator")

class GnosiOrchestrator:
    def __init__(self):
        self.state = self._load_state()
        LOCKS_DIR.mkdir(parents=True, exist_ok=True)
        MAILBOX_DIR.mkdir(parents=True, exist_ok=True)
        LOGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    def _load_state(self):
        if not TASKS_FILE.exists():
            log.error(f"Tasks file not found: {TASKS_FILE}")
            return None
        with open(TASKS_FILE, 'r') as f:
            return json.load(f)

    def _save_state(self):
        self.state["last_updated"] = datetime.now().isoformat()
        with open(TASKS_FILE, 'w') as f:
            json.dump(self.state, f, indent=2)

    def _get_lock(self, task_id):
        lock_file = LOCKS_DIR / f"{task_id}.lock"
        if lock_file.exists():
            return False
        lock_file.touch()
        return True

    def _release_lock(self, task_id):
        lock_file = LOCKS_DIR / f"{task_id}.lock"
        if lock_file.exists():
            lock_file.unlink()

    def run_loop(self, max_iterations=5):
        log.info("Starting Gnosi Autonomous Loop")
        iterations = 0
        while iterations < max_iterations:
            self.state = self._load_state()
            pending_task = self._get_next_task()
            
            if not pending_task:
                log.info("No pending tasks. Loop finished.")
                break
                
            log.info(f"Processing Task: {pending_task['id']} - {pending_task['title']}")
            
            if self._get_lock(pending_task['id']):
                try:
                    success = self._execute_task(pending_task)
                    if success:
                        pending_task["status"] = "DONE"
                        log.info(f"Task {pending_task['id']} COMPLETED.")
                    else:
                        pending_task["status"] = "FAILED"
                        log.error(f"Task {pending_task['id']} FAILED.")
                finally:
                    self._release_lock(pending_task['id'])
                    self._save_state()
            else:
                log.warning(f"Task {pending_task['id']} is locked. Skipping.")
            
            iterations += 1
            time.sleep(1)

    def _get_next_task(self):
        for task in self.state.get("tasks", []):
            if task["status"] in ["TODO", "WAITING"]:
                # Check dependencies
                deps_ok = True
                for dep_id in task.get("dependencies", []):
                    dep_task = next((t for t in self.state["tasks"] if t["id"] == dep_id), None)
                    if not dep_task or dep_task["status"] != "DONE":
                        deps_ok = False
                        break
                if deps_ok:
                    return task
        return None

    def _execute_task(self, task):
        role = task.get("assigned_to", "Specialist")
        log.info(f"Delegating to {role}...")
        
        # In a real scenario, this would call a specific skill or script.
        # For this prototype, we use the Specialist to run a sandbox script if referenced.
        
        # Simulate logic step
        prompt = f"Executing task {task['id']}: {task['title']}\nDescription: {task['description']}\nRole: {role}\nResult required: Success."
        
        try:
            # Here we could use call_ai_with_fallback to decide the next action
            # response, provider = call_ai_with_fallback(prompt)
            # log.info(f"AI ({provider}) suggested: {response[:50]}...")
            
            # For now, simulate successful execution
            time.sleep(2)
            task["history"].append({
                "timestamp": datetime.now().isoformat(),
                "action": "Autonomous Execution",
                "by": role,
                "note": "Task executed by autonomous orchestrator."
            })
            return True
        except Exception as e:
            log.exception(f"Error during execution of {task['id']}")
            return False

if __name__ == "__main__":
    orch = GnosiOrchestrator()
    orch.run_loop()
