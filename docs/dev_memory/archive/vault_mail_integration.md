# Directiva: Integració de Mail al Vault

Aquesta directiva defineix l'arquitectura de la integració del correu electrònic amb el Cervell Digital. Els detalls tècnics d'implementació i els protocols de generació de fitxers estan consolidats a la Skill corresponent.

## Visió General
L'objectiu és que el flux de comunicació externa (Mail) sigui processat i emmagatzemat com a coneixement actiu (Notes) dins de la jerarquia del Vault.

## Punts de Control Arquitectònics
1. **Model de Dades**: Cada mail s'ha de tractar com un objecte de base de dades amb propietats de remitent, data i assumpte.
2. **Visibilitat**: La integració ha de garantir que els correus siguin indexables i apareguin en les vistes agregades del Dashboard.

---

## Implementació Tècnica
Per a protocols de generació de frontmatter (YAML), IDs de taula (`mail`) i scripts d'execució, consulteu:

- [**Skill: Mail Sync**](../../../monorepo/apps/gnosi/pipeline/skills/mail_sync/SKILL.md)

---
*Nota: Aquesta directiva serveix com a nexe d'unió entre la lògica de negoci i l'eina técnica.*
