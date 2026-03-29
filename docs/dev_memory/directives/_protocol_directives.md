# Directive: Protocol de Desenvolupament

## Objectiu
Workflow que combina artefactes interns (ràpids) amb directives persistents (coneixement permanent).

## El Loop Central

### FASE 1: PLANNING
```
1. Consultar directives existents
   → ls docs/dev_memory/directives/
   → Si n'hi ha de rellevant, llegir-la

2. Crear implementation_plan.md (artefacte intern)
   → Ubicació: ~/.gemini/antigravity/brain/<id>/
   → Conté: canvis proposats, fitxers afectats

3. Sol·licitar aprovació de l'usuari
```

### FASE 2: EXECUTION
```
4. Actualitzar task.md (artefacte intern)
   → Tracking en temps real amb checkboxes

5. Anotar errors/edge cases trobats
   → Per incloure'ls a la directiva final
```

### FASE 3: COMPLETION
```
6. Crear walkthrough.md (artefacte intern)
   → Resum del que s'ha fet
   → Screenshots si aplica

7. ⭐ CONVERTIR WALKTHROUGH A DIRECTIVA
   → Ubicació: docs/dev_memory/directives/<nom_tasca>.md
   → Format: Procediment + Edge Cases + Verificació
```

## Regla Clau

> **Al final de cada tasca complexa, SEMPRE generar/actualitzar una directiva a `docs/dev_memory/directives/`**

## Checklist Final de Tasca
- [ ] Codi funcionant i verificat
- [ ] Artefactes interns actualitzats (task.md, walkthrough.md)
- [ ] **Directiva creada/actualitzada a docs/dev_memory/directives/**
- [ ] Edge cases documentats a la directiva

## Quan NO cal crear directiva
- Preguntes simples o conversa casual
- Edicions trivials (1-2 línies)
- Tasques que no aporten coneixement reutilitzable

## Annex: Conversió Walkthrough → Directiva

| Secció Walkthrough | Secció Directiva |
|-------------------|------------------|
| Summary | Objectiu |
| Changes Made | Procediment |
| What was tested | Verificació |
| Errors encountered | Restriccions / Edge Cases |
| Files modified | Fitxers Relacionats |
