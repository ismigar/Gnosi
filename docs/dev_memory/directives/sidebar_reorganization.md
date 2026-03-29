# Directiva: Reorganització del Menú Lateral (Sidebar)

## Objectiu
Reorganitzar els elements del menú lateral segons el nou ordre de prioritats i optimitzar l'espai visual per a un disseny més compacte.

## Context
L'usuari vol prioritzar l'accés a Vault, Graf, Mail, Calendari i Social Media, deixant les eines de control i configuració separades a la part inferior. A més, es busca reduir els marges per aprofitar millor l'espai.

## Lògica / Passos
1. **Ordre del Menú**:
    - Mantenir el Logo a la part superior (enllaç a Home).
    - Llista principal (en aquest ordre): Vault, Graf, Mail, Calendari, Social Media.
    - Separador / Àrea inferior: Control Center i Configuració.
2. **Ajustos de Disseny (CSS)**:
    - Reduir l'amplada (`width`) de la barra lateral de 68px a uns 60-64px segons visualització.
    - Reduir el `gap` entre els elements de 1.5rem a 1rem o 0.75rem.
    - Reduir els marges laterals (ajustant el padding o l'amplada dels ítems).

## Restriccions i Advertències
- No eliminis funcionalitats: encara que no es demanin explícitament Lector, Composer o Scheduler, assegura't que el canvi és el que l'usuari vol (normalment vol simplificar el que veu primer).
- Mantingues els tooltips per a cada icona.
- El logotip de Gnosi ("G") ha de seguir portant a l'arrel (`/`).

## Verificació
- Validar visualment l'ordre de les icones.
- Comprovar que els tooltips mostren l'etiqueta correcta.
- Verificar que el nou espaiat és harmònic i no sembla amuntegat.
