# Directive: Calendar Event Hover Pop-up

## Context
The user wants to see event details (a pop-up/tooltip) when hovering over appointments in the calendar.

## Objectives
- Implement a hover-triggered pop-up for calendar events.
- The pop-up should show: Title, Time/Range, Location (if available), and a snippet of the Description.
- Ensure the pop-up feels "premium" (smooth transitions, nice typography, glassmorphism).

## Implementation Plan

### 1. Frontend State (`DigitalBrainCalendar.jsx`)
- Add `hoveredEvent` state: `{ event: any, position: { x: number, y: number } } | null`.

### 2. FullCalendar Integration
- Implement `eventMouseEnter`:
    - Calculate position (using `jsEvent.clientX/Y`).
    - Set `hoveredEvent` state.
- Implement `eventMouseLeave`:
    - Set `hoveredEvent` to `null`.

### 3. Tooltip Component
- Create a local component (or inline) that renders a fixed/absolute div.
- Styles:
    - `z-index: 1000`
    - `pointer-events: none`
    - `backdrop-filter: blur(12px)`
    - `background: rgba(var(--bg-primary-rgb, 255, 255, 255), 0.85)`
    - `border: 1px solid var(--border-primary)`
    - `border-radius: 12px`
    - `padding: 12px`
    - `box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)`

### 4. Content Logic
- Extract data from `arg.event.extendedProps.metadata`.
- Format dates/times nicely using browser locales.
- Truncate description if too long.

## Constraints
- Do not block interaction.
- Dark mode compatibility.
- Screen edge overflow prevention.

## Verification
- Hover over various types of events.
- Check Dark mode.
