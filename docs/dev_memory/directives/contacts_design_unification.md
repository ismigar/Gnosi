# Contacts Design Unification Directive

## Overview
This directive outlines the steps to unify the Contacts application with the global Gnosi design system and integrate contact-specific settings into the main settings modal.

## Design Goals
1. **Consistency**: Use CSS variables (`var(--bg-primary)`, `var(--gnosi-primary)`, etc.) instead of hardcoded Tailwind colors.
2. **Premium Aesthetic**: Implement the Gnosi premium look (glassmorphism, subtle borders, specific typography).
3. **Dark Mode**: Support the "pure black" dark mode directive.
4. **Layout**: Ensure the Contacts page follows the standard Gnosi layout (Sidebar + Content).

## Settings Integration
1. **New Tab**: Add a "Contacts" tab to the `GlobalSettingsModal`.
2. **Sync Control**: Move sync-related actions and status to the settings modal.
3. **Configuration**: Allow users to configure Google Contacts integration and other preferences from settings.

## Technical Rules
1. **Icons**: Use `lucide-react` exclusively.
2. **CSS**: Prefer CSS variables over Tailwind utility classes for colors and themes.
3. **Internal State**: Use `useApi` hook for backend communication.
4. **Translations**: Use `i18next` for all text.

## Edge Cases & Restrictions
- **Google Auth**: Ensure Google sync is only available if Google Auth is configured.
- **Responsive**: Maintain the flex-based layout for mobile compatibility.
