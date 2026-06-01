import sys
from pathlib import Path

# Afegir el path del backend per poder importar els mòduls
backend_path = Path(__file__).resolve().parents[1] / "monorepo" / "apps" / "gnosi" / "backend"
sys.path.append(str(backend_path))

try:
    from config.app_config import load_params
    cfg = load_params(strict_env=False)
    print("Dades carregades de params.yaml:")
    print(cfg.params)
    print("\nCamp 'paths' detectat:")
    print(cfg.params.get('paths'))
except Exception as e:
    print(f"Error en el diagnòstic: {e}")
