# DIRECTIVE: MAIL_APP_DESIGN

> ID: 2026-03-03
Associated Script: N/A (UI Design) Last Update: 2026-03-03
Status: DRAFT

---

## 1. Objectius i Abast

Aquesta directiva defineix l'estàndard de disseny i comportament per a la nova aplicació de gestió de correu dins de Gnosi.

- **Objectiu Principal:** Crear una experiència de correu moderna, ràpida i integrada amb el Vault de Gnosi.
- **Criteris d'Èxit:**
  - Interfície de 3 columnes (Filtres, Llista, Vista).
  - Sincronització fluida amb els fitxers Markdown generats per `mail_sync`.
  - Estètica premium (glassmorphism, micro-animacions).

## 2. Especificacions d'I/O

### Inputs
- Fitxers Markdown al Vault amb frontmatter `type: mail`.
- Credencials IMAP definides a `.env_shared`.

### Outputs
- Interfície de React a `/mail`.

## 3. Flux Lògic (Algorisme de la UI)

1. **Càrrega:** La UI demana al backend la llista de fitxers tipus `mail`.
2. **Filtrat:** S'apliquen filtres per carpeta (segons el camí al Vault o etiqueta).
3. **Selecció:** En seleccionar un correu, es llegeix el fitxer Markdown i es renderitza.
4. **Accions:** Marcar com a llegit (canviar frontmatter), moure a brossa (moure fitxer), etc.

## 4. Eines i Llibreries

- **Frontend:** React, Lucide React (icones), Framer Motion (animacions).
- **Backend:** FastAPI, Python (per a la manipulació de fitxers Markdown).

## 5. Restriccions i Casos Extrems

- **Rendiment:** Si hi ha milers de correus, la llista s'ha de paginar o fer scroll infinit.
- **Fitxers binaris:** Els adjunts encara no estan implementats en la versió actual de `mail_sync`.

## 6. Protocols de l'Observador

L'agent ha de seguir el "Self-Correction Protocol" si la integració amb els fitxers Markdown falla.
Assegurar-se que el canvi de l'estatus "unread" a "read" és persistent al fitxer físic.
