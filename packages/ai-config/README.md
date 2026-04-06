# @projectes/ai-config

Capa unificada para configuración de proveedores/modelos IA con:

- Validación estricta de configuración
- Resolución de secretos con prioridad env > profile > config
- Discovery dinámico por plugins
- Catálogo efectivo determinista
- Selección final con default/fallback/allowlist

## API principal

- `resolveEffectiveModel(rawConfig, context)`

## Desarrollo

```bash
npm run build
npm run test
```
