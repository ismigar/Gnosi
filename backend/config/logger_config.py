import logging
from typing import Optional

from .paths_config import LOG_DIR

# Configure the log directory and file (resilient to None for March 30)
LOG_FILE = (LOG_DIR / "gnosi.log") if LOG_DIR else None


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Encapsulated log setup with console and file handlers."""
    fmt = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
    datefmt = "%H:%M:%S"

    # Console handler is ALWAYS safe
    handlers: list[logging.Handler] = [logging.StreamHandler()]

    # File handler is only attempted if VAULT_PATH is configured
    if LOG_DIR and LOG_FILE:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            handlers.append(logging.FileHandler(LOG_FILE, encoding="utf-8"))
        except Exception as e:
            # We don't use log.error here because logging isn't fully setup yet
            print(f"Error initializing file logging: {e}")

    logging.basicConfig(
        level=level,
        format=fmt,
        datefmt=datefmt,
        handlers=handlers,
    )

    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("notion_client").setLevel(logging.WARNING)

    return logging.getLogger(__name__)


def get_logger(name: Optional[str] = None) -> logging.Logger:
    return logging.getLogger(name)
