# Directiva: Gestió d'Errors i Fallback d'IA

## Context
Quan un proveïdor d'IA (com Groq) arriba al seu límit de taxa (rate limit), el backend pot retornar errors que el frontend ha de capturar graciosament.

## Procediment de Gestió d'Errors
1. **Detecció**: Capturar excepcions de LangChain/API al backend (`agent_routes.py`).
2. **Streaming d'Error**: Enviar un esdeveniment de tipus `error` amb un contingut (`content`) que expliqui el problema de forma humana (ex: "Has superat la quota de Groq").
3. **Fallback Automàtic**: Al `factory.py`, si el proveïdor principal falla en ser instanciat, intentar el següent proveïdor configurat que tingui clau d'API.

## UI/UX (Frontend)
- El component `AgentChat.jsx` ha de mostrar un missatge d'error clar.
- No s'han de mostrar bombolles de missatge buides mentre s'espera la resposta si sabem que hi ha hagut un error.

## Restriccions
- No intentar fer fallback a un mateix proveïdor amb el mateix model si l'error és de rate limit.
