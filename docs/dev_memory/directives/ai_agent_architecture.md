# Directiva: Arquitectura de l'Agent IA (Digital Brain)

## Descripció
Aquesta directiva defineix com es construeix i es gestiona l'Agent IA del Cervell Digital. L'objectiu és tenir un nucli d'intel·ligència comú però capaç d'adoptar diferents perfils segons el context de l'aplicació.

## Arquitectura de l'Agent
L'agent es basa en un graf de **LangGraph** amb un model **Multi-Agent**:
- **Supervisor (Director/Alejabot)**: El cervell central que decideix quin especialista ha d'actuar. Gestiona l'infraestructura `.antigravity/team/`.
- **Coder (Specialist)**: Specialist en codi, fitxers i git. Executa les tasques de `tasks.json`.
- **Brain (Architect)**: Specialist en coneixement i disseny d'arquitectura.
- **Reviewer**: Rol de QA que aplica el protocol de verificació abans del "Done".
- **General**: Per a converses trivials.

## Estratègia de Perfils (Personas)
Per permetre que l'agent sigui versàtil, implementarem "Perfils". Un perfil modifica:
1. El **System Prompt** del Supervisor.
2. Les **Eines** disponibles per a l'agent.
3. El **Tò de veu**.

### Perfils Inicials Proposats:
- **Default / Arquitecte**: Gestiona tot el cervell digital. (Perfil actual).
- **Content Creator**: Enfocat en la gestió d'articles, xarxes socials i Notion.
- **Senior Developer**: Enfocat en la pipeline, Docker i millores de codi.
- **Data Analyst**: Enfocat en el graf de coneixement i visualització de dades.

## Protocols d'Integració
- **Backend**: FastAPI amb streaming NDJSON.
- **Frontend**: Component `AgentChat` que envia el `profile_id` i el `session_id`.
- **Eines**: Totes les eines MCP han de ser accessibles pel perfil "Arquitecte", però filtrades per altres perfils si cal.

## Instruccions de Desenvolupament
31. No dupliquis la lògica del graf. Usa una factory que accepti un `config` de perfil.
32. Totes les interaccions han de quedar registrades a la memòria (.antigravity/team/tasks.json).
33. Prioritza Ollama (local) per a tasques simples per estalviar costos/privacitat, i Groq/OpenAI per a tasques complexes.
34. Quan un especialista acaba, el Director ha de moure el missatge a la bústia de revisió.
