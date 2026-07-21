# Directive: Error Handling

## Objective
Standard patterns for handling errors consistently and informatively.

## Principles

1. **Always Capture** - Never leave exceptions unhandled.
2. **Inform Clearly** - The user must know what failed.
3. **Document** - New errors → update the directive.
4. **Recover if Possible** - Retry with backoff for temporary errors.

---

## Base Pattern

```python
from langchain_core.tools import tool

@tool
def my_tool(param: str) -> str:
    """Description of the tool."""
    try:
        # Main logic
        result = do_something(param)
        return f"✅ Operation completed: {result}"
    
    except ValueError as e:
        return f"❌ Validation error: {e}"
    
    except ConnectionError as e:
        return f"❌ Connection error: {e}. Try again."
    
    except Exception as e:
        return f"❌ Unexpected error: {type(e).__name__}: {e}"
```

---

## Common Errors and Solutions

### Connection Errors
```python
import time

def with_retry(func, max_retries=3, backoff=1.0):
    for attempt in range(max_retries):
        try:
            return func()
        except ConnectionError:
            if attempt < max_retries - 1:
                time.sleep(backoff * (2 ** attempt))
            else:
                raise
```

### Rate Limit Errors
```python
def handle_rate_limit(func):
    try:
        return func()
    except RateLimitError:
        time.sleep(60)  # Wait 1 minute
        return func()
```

### Validation Errors
```python
def validate_input(value, expected_type, name):
    if not isinstance(value, expected_type):
        raise ValueError(f"{name} must be {expected_type.__name__}, received {type(value).__name__}")
```

---

## Error Message Format

| Type | Prefix | Example |
|-------|--------|---------|
| Success | ✅ | `✅ Operation completed: 10 articles found` |
| Warning | ⚠️ | `⚠️ Partial result: 5 of 10 processed` |
| Recoverable | ❌ | `❌ Connection error. Retrying...` |
| Fatal | 🚫 | `🚫 Critical error: Cannot continue` |

---

## Logging

```python
import logging
logger = logging.getLogger(__name__)

# Appropriate levels
logger.debug("Debugging details")
logger.info("Operation started")
logger.warning("Unexpected but recoverable situation")
logger.error("Error affecting functionality")
logger.critical("Error requiring immediate intervention")
```

---

## Discovered Traps

| Date | Trap | Solution |
|------|------|----------|
| 2026-01-18 | Silenced exceptions hide bugs | Always log before catching |
| 2026-01-18 | Generic messages don't help | Include specific context |

---
*Last Update: 2026-04-08*
