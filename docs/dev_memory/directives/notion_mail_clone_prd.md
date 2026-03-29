# DIRECTIVE: NOTION_MAIL_CLONE_PRD

> ID: 20260306
> Associated Script: N/A (Architecture Directive)
> Last Update: 2026-03-06
> Status: DRAFT

---

## 1. Objectives and Scope
- **Main Objective:** Crear un cliente de correo premium dentro de Gnosi que imite la experiencia de Notion Mail.
- **Success Criteria:** 
    - UI de 3 columnas (Sidebar, Lista, Visor).
    - Mapeo completo de campos (De, A, Cc, Cco, Assumpte, Adjunts, Data de recepció, Llegit, etc.).
    - Capacidad de asignar recordatorios y guardar en Notion/Vault.
    - Firmas HTML y Asistente de IA.

## 2. Input/Output (I/O) Specifications
### Inputs
- **Accounts:** Configuraciones de correo (SMTP/IMAP) obtenidas de `GlobalSettingsModal`.
- **API Gmail/IMAP:** Para la obtención de hilos y mensajes.
- **IA Provider:** Groq/OpenAI configurado en el sistema para la redacción.

### Outputs
- **Mail Metadata:** Persistencia local de estados (snooze, labels, categories) en `Vault`.
- **Vault Pages:** Entradas en tablas de Notion cuando el usuario elija "Add to Notion".

## 3. Logical Flow (Algorithm)
1. **Sync Layer:** Extender el sincronizador actual para capturar metadatos avanzados y categorizar (Promociones, Social).
2. **Metadata Layer:** Gestionar estados "Gnosi-specific" como el snooze (fecha de reaparición).
3. **UI Layer:** Renderizar la interfaz de 3 columnas con el visor mostrando propiedades de Notion al inicio.
4. **Action Layer:** Implementar endpoints para Archiu, Esborrar, Contestar y Reenviar.
5. **AI Layer:** Pipeline para enviar contexto del hilo al asistente y recibir sugerencias de redacción.

## 4. Tools and Libraries
- **Frontend:** React, Tailwind (si se permite) o CSS Vanilla (preferido por premium feel), Lucide Icons.
- **Backend:** FastAPI, `google-api-python-client`, `imaplib`, `pydantic`.
- **IA:** LangChain o llamadas directas a APIs configuradas en Gnosi.

## 5. Restrictions and Edge Cases
- **HTML Signatures:** Deben sanitizarse para evitar ataques XSS pero permitirse etiquetas básicas de diseño.
- **Snooze Logic:** Requiere una tarea programada (cron/scheduler) para marcar como "Inbox" correos en la fecha de recordatorio.
- **Attachments:** Deben guardarse en `Vault/Assets` si se vinculan a una nota.

## 6. Pre-Execution Checklist
- [ ] Validar que las credenciales IMAP/Google están activas.
- [ ] Verificar acceso de escritura al `Vault` de Gnosi.
- [ ] Asegurar que el Scheduler de Gnosi está funcionando.

## 10. Additional Notes
El diseño debe seguir el "premium feel" de Notion Mail: espaciado generoso, fuentes sans-serif modernas y ausencia de bordes pesados.
