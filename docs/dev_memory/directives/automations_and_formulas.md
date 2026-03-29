# Directiva: Automatitzacions i Fòrmules al Vault (Gnosi)

Aquesta directiva defineix el sistema d'automatitzacions i fòrmules per completar la potència de les bases de dades del Digital Brain, permetent comportaments dinàmics i càlculs automàtics entre propietats.

## 1. Fòrmules (Spreadsheet-like)

Les fòrmules permeten calcular el valor d'una propietat basant-se en altres propietats del mateix registre o de registres relacionats.

### Definició al Registry (`vault_db_registry.json`)
S'afegeix el tipus `formula` a les propietats d'una taula.
```json
{
  "name": "Total amb IVA",
  "type": "formula",
  "formula_config": {
    "expression": "Import * 1.21"
  }
}
```

### Motor de Càlcul
- Les fòrmules s'avaluen al **Backend** durant l'operació de `save` o `patch`.
- El resultat es guarda físicament al Frontmatter per permetre cerques i filtrat indexat.
- Opcionalment, es poden avaluar al **Frontend** per a feedback en temps real (sense persistència fins a desar).

## 2. Automatitzacions (Triggers & Actions)

Les automatitzacions executen accions quan es compleixen certes condicions de canvi en les dades.

### Definició a la Taula
Cada taula pot tenir una llista d'automatitzacions.
```json
{
  "id": "notes",
  "automations": [
    {
      "name": "Actualitzar Projecte des de Tasca",
      "trigger": {
        "type": "property_change",
        "property": "task_ids"
      },
      "action": {
        "type": "update_property",
        "target_property": "project_ids",
        "expression": "lookup('tasks', task_ids, 'project_ids')"
      }
    }
  ]
}
```

### Conceptes Clau:
- **Trigger**: `property_change`, `on_create`, `on_delete`.
- **Action**: `update_property`, `notify`, `trigger_webhook`.
- **Lookup**: Capacitat de viatjar per les relacions per obtenir dades d'altres taules.

## 3. Pseudollenguatge de fòrmules

S'utilitzarà una sintaxi basada en Python simplificat o una llibreria d'expressió segura.

### Funcions suportades:
- `prop('nom')`: Obté el valor d'una propietat.
- `lookup(taula, id, propietat)`: Obté el valor d'una propietat d'un registre d'una altra taula.
- `first(llista)` / `last(llista)`: Operacions amb llistes (especialment per a relacions).
- Operadors matemàtics i de strings estàndard.

## 4. Protocol d'Execució

1. L'usuari envia un `PATCH` o `PUT` a `/api/vault/pages/{id}`.
2. El servidor carrega la metadata actual.
3. El `RuleEngine` identifica els trigger actius basant-se en la diferència (`diff`) de dades.
4. S'avaluen les fòrmules pendents.
5. S'executen les accions de les automatitzacions.
6. Es desa el resultat final al fitxer `.md`.

## 5. Restriccions i Seguretat
- **Recursivitat**: Cal limitar la profunditat de les automatitzacions per evitar bucles infinits (ex: A actualitza B, B actualitza A).
- **Seguretat**: No s'ha de permetre l'execució de codi Python arbitrari (`eval` perillós). Usar un entorn controlat.
- **Performance**: Les lookups pesades han d'estar cachejades o ser optimitzades.
