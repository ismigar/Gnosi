# Directive: Backend Background Scheduler (SchedulerManager)

## Description
The Digital Brain backend contains an internal background task scheduler managed by `SchedulerManager` (located in `backend/scheduler/manager.py`). This scheduler is responsible for periodically executing tasks like fetching RSS feeds (`fetch_feeds`), POP3 newsletters (`fetch_newsletters`), and generating daily podcasts (`generate_podcast`). 

## Core Principles
1. **Background Loop**: 
   The `SchedulerManager` initializes a daemon thread on instantiation (`self.start()`). This loop wakes up every 60 seconds to evaluate if any enabled tasks have surpassed their `next_run` timestamp.
   
2. **Non-blocking Execution**:
   When a task is triggered, it runs in a separate `threading.Thread(target=self._run_task_background, ...)`. This ensures that long-running tasks do not block the main scheduler loop from evaluating other impending tasks.
   
3. **State Persistence**: 
   Tasks are defined and their persistence (last run, next run, status) is stored in `data/scheduler_config.json`. 

## Restrictions & Edge Cases
- **Missing Background Loop**: Originally, `SchedulerManager` was missing an actual `while` loop implementation to invoke the tasks automatically. Without `start()`, `_scheduler_loop()`, and `_run_task_background()`, scheduled periodic tasks will sit idle indefinitely.
- **Error Handling**: The `_scheduler_loop` catches exceptions and handles timestamps cleanly. If a `next_run` fails to parse, it aggressively runs the task. Upon completion or failure (`success`, `error`), the task recalculates its `next_run` into the future based on its interval.
- **Configuration Directory Integrity**: Ensure that the `config/` directory stays at the project root (`monorepo/apps/gnosi/config`). Accidental displacement into `frontend/dist/` will result in `ModuleNotFoundError: No module named 'config'`.

## Interactions with other systems
- **Manual Runs**: Tasks can be triggered manually overriding the loop via the REST API (`POST /api/schedulers/{name}/run`), which overrides and executes synchronously.
