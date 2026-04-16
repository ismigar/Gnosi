# Directiva: Restauració de Configuració d'AI

## Context
La configuració de l'AI a Gnosi es guarda al fitxer `params.yaml`. Si la llista d'agents està buida o l'`active_agent_id` no existeix, el sistema retorna un error "No LLM provider available".

## Procediment de Restauració
1. Localitzar el fitxer `params.yaml` actiu (normalment al Vault o a `~/.gnosi/`).
2. Verificar la secció `ai:`.
3. Si `agents` és una llista buida, s'ha de restaurar l'agent predeterminat `gnosy`.
4. Assegurar-se que el proveïdor (provider) i el model (model) coincideixen amb els que el sistema pot gestionar (ex: Groq, OpenAI).
5. Establir `active_agent_id` al ID de l'agent restaurat.

## Restriccions i Casos de Cantonada
- **Keychain:** Si el provider utilitza el prefix `__keychain__:`, la clau d'API s'ha de gestionar via el sistema de credencials de Gnosi, no directament al fitxer YAML.
- **Enabled:** L'agent ha de tenir `enabled: true`.

## Verificació
- El backend ha de ser capaç d'instanciar el workflow sense errors 503.
- El xat del frontend ha de mostrar que el model s'ha seleccionat correctament.
