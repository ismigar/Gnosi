# Skill: Team Manager (Alejabot Team)

## Descripció
Aquesta skill permet gestionar l'infraestructura física de l'equip multiagèntic. Centralitza l'escriptura i lectura de `tasks.json`, la gestió de missatges a la bústia i el control de bloquejos de fitxers.

## Estructura
- **Directori**: `.antigravity/team/`
- **Fitxer d'Estat**: `tasks.json`
- **Bústia**: `mailbox/`
- **Bloquejos**: `locks/`

## Protocols d'Ús

### 1. Inicialització de Tasca
Quan el Director vol començar una nova tasca:
- Executa l'script de creació de tasca.
- L'script assigna un ID (p.e. TASK-001) i un estat d'inici.
- Es crea un fitxer de missatge a `mailbox/director.msg` amb els detalls.

### 2. Canvi de Rol
- L'agent ha de declarar el rol actual segons el `tasks.json`.
- Qualsevol modificació de codi ha de ser precedida per un bloqueig a `locks/` si el fitxer és compartit.

### 3. Finalització i QA
- Un cop acabada la tasca, el Specialist mou el missatge a la bústia del Reviewer.
- El Reviewer executa el **QA Protocol** (Build, Browser Test, E2E).
- Només si tot és correcte, s'actualitza el `tasks.json` a estat `DONE`.

## Dependències
- Python 3.12+
- `json` biblioteca estàndard per a `tasks.json`.

---
*Manteniment: Aquesta skill s'ha d'actualitzar amb nous rols a mesura que l'equip creixi.*
