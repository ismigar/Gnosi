# Protocol de Verificació QA (Protocol Antigravity)

Aquest és el protocol de seguretat obligatori que s'ha de seguir després de qualsevol modificació al Frontend o Backend que afecti la UI.

## Objectiu
Garantir que cap canvi enviat a l'usuari provoqui un "pantallazo blanco", errors de referència (variables no definides) o fallades de compilació.

## Passos Obligatoris

### 1. Verificació de Sintaxi i Compilació
Abans de qualsevol `notify_user`:
- **Executar `npm run build`**: S'ha d'adjuntar el resultat o confirmar que ha acabat amb `Exit code: 0`. Això detecta imports oblidats i errors de tipus/sintaxi que Vite no veu en mode dev ràpid.
- **Grep de Variables**: Si s'ha eliminat codi, fer un `grep` per assegurar-se que cap part del JSX encara referencia variables eliminades.

### 2. Verificació de Runtime (Navegador)
No n'hi ha prou amb que compili. Cal provar-ho:
- **Obrir `localhost:5173/vault`** (o l'URL corresponent) utilitzant el `browser_subagent`.
- **Accions Crítiques**:
    - Carregar la pàgina inicial.
    - Clicar en una entrada del Sidebar (obrir pàgina).
    - Obrir una Taula/Base de Dades.
- **Captura de Pantalla**: Fer un screenshot del port 5173 per confirmar visualment que la UI és present.

### 3. Seguiment al `task.md`
Totes les tasques de desenvolupament han d'incloure:
- `[ ] Verificar integritat amb npm run build`
- `[ ] Validació visual i de funcionalitat al navegador`

## Autocrítica Obligatòria
Si un canvi passa aquest protocol i tot i així falla al costat de l'usuari, s'ha de documentar l'error específic aquí per reforçar el protocol (ex: "Afegeix prova de clic en modals").

---
**Nota per a l'Agent**: La violació d'aquest protocol es considera una fallada crítica en el lliurament de la tasca.
