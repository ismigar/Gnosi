# config/logger_config.py
import logging
from typing import Optional
from config.paths_config import LOG_DIR

# ─────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────
# Default logging level (propagates globally)
# ─────────────────────────────────────────────────────
DEFAULT_LOG_LEVEL = "INFO"   # pots posar "DEBUG" o "WARNING"
LOG_FILE =  LOG_DIR / "notion_scripts.log"

# ─────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────
# Basic logging configuration
# ─────────────────────────────────────────────────────
def setup_logging(level: Optional[str] = None):
    """
    Configure the global logging system.
    If already configured, only adjusts the level.
    """
    log_level = (level or DEFAULT_LOG_LEVEL).upper()

    # Create logs directory if it does not exist
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Prevent handler duplication on multiple calls
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(log_level)
        return root

    fmt = "%(asctime)s %(levelname)s [%(name)s]: %(message)s"
    datefmt = "%H:%M:%S"

    logging.basicConfig(
        level=log_level,
        format=fmt,
        datefmt=datefmt,
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
        ],
    )

    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("notion_client").setLevel(logging.WARNING)

    return logging.getLogger(__name__)

# ─────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────
# Helper function to obtain named loggers
# ─────────────────────────────────────────────────────
def get_logger(name: Optional[str] = None):
    return logging.getLogger(name)
