# pipeline/ai_client.py
"""
Hybrid AI Client supporting multiple providers (Ollama local + Groq cloud).
Implements fallback logic: tries primary provider first, falls back to secondary on failure.
"""
import requests
from config.logger_config import setup_logging, get_logger
from config.app_config import load_params
from config.env_config import get_env
import json
import hashlib
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from config.paths_config import get_paths
from backend.security.ai_credentials import resolve_provider_api_key

paths = get_paths()
CACHE_FILE = paths["OUT_DIR"] / "ai_cache.json"

cfg = load_params(strict_env=False)
setup_logging(getattr(cfg, "log_level", "INFO"))
log = get_logger(__name__)

# Provider configurations from params.yaml
PROVIDERS = cfg.ai.get("providers", {})
PRIMARY_PROVIDER = cfg.ai.get("primary_provider", "ollama")
FALLBACK_PROVIDER = cfg.ai.get("fallback_provider", "groq")

# Legacy compatibility: if no providers defined, use flat config
if not PROVIDERS:
    PROVIDERS = {
        "default": {
            "model_name": cfg.ai.get("model_name", "llama3.2"),
            "model_url": cfg.ai.get("model_url", "http://localhost:11434/v1/chat/completions"),
            "timeout": cfg.ai.get("timeout", 120),
            "retries": cfg.ai.get("retries", 2),
            "max_content_chars": 8000
        }
    }
    PRIMARY_PROVIDER = "default"
    FALLBACK_PROVIDER = None


def _load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning(f"Could not load cache: {e}")
    return {}


def _save_cache(cache: dict):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log.warning(f"Could not save cache: {e}")


# Global cache loaded once
_AI_CACHE = _load_cache()


def get_provider_config(provider_name: str) -> Dict[str, Any]:
    """Get configuration for a specific provider."""
    config = PROVIDERS.get(provider_name, {})
    if not config:
        raise ValueError(f"Unknown provider: {provider_name}")
    return config


def _call_provider(
    provider_name: str,
    prompt: str,
    timeout: Optional[int] = None
) -> str:
    """
    Call a specific AI provider.
    
    Args:
        provider_name: Name of the provider (ollama, groq)
        prompt: The prompt to send
        timeout: Optional timeout override
        
    Returns:
        AI response content
        
    Raises:
        RuntimeError: On API errors
        requests.exceptions.Timeout: On timeout
    """
    config = get_provider_config(provider_name)
    
    model = config.get("model_name")
    url = config.get("model_url")
    default_timeout = config.get("timeout", 120)
    
    headers = {"Content-Type": "application/json"}
    
    # Add auth header for cloud providers resolved from secure storage/env/config.
    resolved_api_key = resolve_provider_api_key(provider_name, config)
    if provider_name == "groq" and not resolved_api_key:
        resolved_api_key = get_env("HF_API_KEY", required=False)
    if resolved_api_key:
        headers["Authorization"] = f"Bearer {resolved_api_key}"
    
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000,
        "temperature": 0.2,
    }
    
    resp = requests.post(
        url,
        headers=headers,
        json=body,
        timeout=timeout or default_timeout
    )
    
    if resp.status_code != 200:
        raise RuntimeError(f"AI error {resp.status_code}: {resp.text[:200]}")
    
    data = resp.json()
    msg = data["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning_content") or ""


def call_ai_client(
    prompt: str,
    stream: bool = False,
    timeout: int = 120,
    provider: Optional[str] = None
) -> str:
    """
    Call AI with caching. Uses specified provider or primary provider.
    
    Args:
        prompt: The prompt to send
        stream: Not used (kept for compatibility)
        timeout: Timeout in seconds
        provider: Specific provider to use (or None for primary)
        
    Returns:
        AI response content
    """
    # 1. Check cache
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if prompt_hash in _AI_CACHE:
        log.debug("⚡ Cache hit for prompt hash %s", prompt_hash[:8])
        return _AI_CACHE[prompt_hash]
    
    # 2. Call provider
    use_provider = provider or PRIMARY_PROVIDER
    config = get_provider_config(use_provider)
    
    content = _call_provider(
        use_provider,
        prompt,
        timeout=timeout or config.get("timeout", 120)
    )
    
    # 3. Save to cache
    if content:
        _AI_CACHE[prompt_hash] = content
        _save_cache(_AI_CACHE)
    
    return content


def call_ai_with_fallback(
    prompt: str,
    timeout_primary: Optional[int] = None,
    timeout_fallback: Optional[int] = None,
    max_chars_primary: Optional[int] = None
) -> Tuple[str, str]:
    """
    Call AI with automatic fallback from primary to secondary provider.
    
    This is the main entry point for the hybrid system:
    1. Try primary provider (Ollama) first
    2. If it fails (timeout, error), add to pending queue and try fallback (Groq)
    3. Return result and which provider succeeded
    
    Args:
        prompt: The prompt to send
        timeout_primary: Timeout for primary provider
        timeout_fallback: Timeout for fallback provider
        max_chars_primary: Max prompt chars for primary (truncate if longer)
        
    Returns:
        Tuple of (response_content, provider_name)
        
    Raises:
        RuntimeError: If both providers fail
    """
    # Check cache first
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if prompt_hash in _AI_CACHE:
        log.debug("⚡ Cache hit for prompt hash %s", prompt_hash[:8])
        return _AI_CACHE[prompt_hash], "cache"
    
    primary_config = get_provider_config(PRIMARY_PROVIDER)
    max_chars = max_chars_primary or primary_config.get("max_content_chars", 2000)
    
    # Truncate prompt for primary provider if needed
    truncated_prompt = prompt
    if len(prompt) > max_chars:
        truncated_prompt = prompt[:max_chars] + "\n[... truncated ...]"
        log.debug(f"📏 Truncated prompt from {len(prompt)} to {max_chars} chars for {PRIMARY_PROVIDER}")
    
    # Try primary provider
    try:
        timeout = timeout_primary or primary_config.get("timeout", 60)
        content = _call_provider(PRIMARY_PROVIDER, truncated_prompt, timeout=timeout)
        
        # Cache the result
        if content:
            _AI_CACHE[prompt_hash] = content
            _save_cache(_AI_CACHE)
        
        return content, PRIMARY_PROVIDER
        
    except requests.exceptions.Timeout as e:
        log.warning(f"⏱️ {PRIMARY_PROVIDER} timeout ({timeout}s), will try {FALLBACK_PROVIDER}")
    except Exception as e:
        log.warning(f"⚠️ {PRIMARY_PROVIDER} failed: {str(e)[:100]}")
    
    # Try fallback provider (with full prompt)
    if FALLBACK_PROVIDER:
        try:
            fallback_config = get_provider_config(FALLBACK_PROVIDER)
            timeout = timeout_fallback or fallback_config.get("timeout", 300)
            
            content = _call_provider(FALLBACK_PROVIDER, prompt, timeout=timeout)
            
            # Cache the result
            if content:
                _AI_CACHE[prompt_hash] = content
                _save_cache(_AI_CACHE)
            
            log.info(f"✅ {FALLBACK_PROVIDER} succeeded as fallback")
            return content, FALLBACK_PROVIDER
            
        except Exception as e:
            log.error(f"❌ {FALLBACK_PROVIDER} also failed: {str(e)[:100]}")
            raise RuntimeError(f"Both {PRIMARY_PROVIDER} and {FALLBACK_PROVIDER} failed")
    
    raise RuntimeError(f"{PRIMARY_PROVIDER} failed and no fallback configured")


def check_provider_availability(provider_name: str) -> bool:
    """Check if a specific provider is reachable."""
    try:
        config = get_provider_config(provider_name)
    except ValueError:
        return False
    
    headers = {"Content-Type": "application/json"}
    if provider_name == "groq" and AI_API_KEY:
        headers["Authorization"] = f"Bearer {AI_API_KEY}"
    
    body = {
        "model": config.get("model_name"),
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 1
    }
    
    try:
        resp = requests.post(
            config.get("model_url"),
            headers=headers,
            json=body,
            timeout=30
        )
        return resp.status_code == 200
    except Exception as e:
        log.warning(f"Provider {provider_name} check failed: {e}")
        return False


def check_model_availability() -> bool:
    """
    Legacy function: Check if primary provider is available.
    Kept for backwards compatibility.
    """
    return check_provider_availability(PRIMARY_PROVIDER)


def get_available_providers() -> Dict[str, bool]:
    """Check availability of all configured providers."""
    result = {}
    for name in PROVIDERS.keys():
        result[name] = check_provider_availability(name)
    return result
