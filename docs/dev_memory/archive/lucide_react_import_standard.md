# Directive: Lucide Icons Import Standard

## Context
In modern React environments (especially with Vite and ESM), `lucide-react` exports common icons as functional components. However, `LucideIcon` is a TypeScript **Type** definition and not a JavaScript **Value**.

## Protocol

### 1. Named Imports
- **DO NOT** import `LucideIcon` as a named value in `.jsx` or `.js` files.
- **DO** import specific icons by name.

```javascript
// ❌ INCORRECT (Causes SyntaxError: does not provide an export named 'LucideIcon')
import { Settings, LucideIcon } from 'lucide-react';

// ✅ CORRECT
import { Settings, Search, X } from 'lucide-react';
```

### 2. Dynamic Icon Rendering
When rendering icons dynamically based on a string name, use the namespace import:

```javascript
import * as LucideIcons from 'lucide-react';

const DynamicIcon = ({ name, size = 20 }) => {
  const IconComponent = LucideIcons[name];
  if (!IconComponent) return null;
  return <IconComponent size={size} />;
};
```

### 3. Type Checking (TypeScript only)
In `.tsx` files, you can import `LucideIcon` as a type using the `type` keyword:

```typescript
import type { LucideIcon } from 'lucide-react';
```

## Constraints & Edge Cases
- **Vite Dependency Pre-bundling**: Vite may fail to bundle the entire application if any component has an invalid import from a library, even if that specific module isn't being executed immediately.
- **Monorepo Unification**: When moving `node_modules` to the root or changing the workspace structure, always clear the Vite cache (`rm -rf node_modules/.vite`) to ensure correct resolution of ESM exports.
