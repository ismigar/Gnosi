from ..schema.runtime_schema import RuntimeConfigSchema


def validate_runtime_config(config: dict) -> RuntimeConfigSchema:
    return RuntimeConfigSchema(**config)


def safe_validate_runtime_config(config: dict) -> dict:
    try:
        data = RuntimeConfigSchema(**config)
        return {"ok": True, "data": data}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
