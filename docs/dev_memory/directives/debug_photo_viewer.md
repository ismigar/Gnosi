# Directiva de Depuració: Visor de Fotos i Servit d'Imatges

## Context
L'usuari informa que el visor de fotos no troba els arxius de les imatges. Les imatges es llisten correctament (indicant que el backend les llegeix del disc), però els thumbnails apareixen buits, indicant que la ruta de servit (`/api/vault/images/...`) falla.

## Problema Detectat
A `monorepo/apps/gnosi/backend/api/vault_routes.py`, la funció `serve_vault_image` utilitza `.resolve()` per validar que el fitxer demanat està dins de `VAULT/Images`:

```python
img_root = (get_p("VAULT") / "Images").resolve()
requested = (img_root / image_path).resolve()

if not str(requested).startswith(str(img_root)):
    raise HTTPException(status_code=403, detail="Access denied")
```

A macOS amb OneDrive, `/Users/ismaelgarciafernandez/Library/CloudStorage/...` pot resoldre's a camins que comencen de forma diferent (ex: `/Volumes/...`) o tenir problemes amb espais, causant un 403 o 404.

## Protocol de Verificació
1. Crear un script a `sandbox/` per simular la resolució de camins amb els paràmetres reals del sistema.
2. Comprovar si `requested.startswith(img_root)` falla tot i ser el mateix directori lògic.
3. Validar el maneig d'espais en la URL (`image_path`).

## Possibles Solucions
- Relaxar la validació de camins o utilitzar `os.path.commonpath`.
- Assegurar-se que el encoding d'espais a la URL es gestiona correctament fins arribar al sistema de fitxers.
- Si `.resolve()` és el culpable, utilitzar camins absoluts normalitzats sense resoldre symlinks si no és estrictament necessari per seguretat.
