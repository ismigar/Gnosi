# DIRECTIVE: MODAL_BEHAVIOR_STANDARD

> ID: 2024-04-17-MODAL-STD
> Status: ACTIVE

---

## 1. Objectius
Garantir un comportament consistent, segur i accessible en tots els quadres de diàleg (modals) de l'aplicació Gnosi.

## 2. Rationale
Els diàlegs són elements crítics de la interfície. Un tancament accidental pot provocar pèrdua de dades o frustració. L'ús del teclat millora l'eficiència dels usuaris avançats.

## 3. Protocol de Comportament (Moll de l'os)

### 3.1. Interacció amb l'exterior (Backdrop)
- **PROHIBIT**: Tancar el diàleg en fer clic a l'overlay/backdrop gris.
- **MOTIU**: Evitar tancaments accidentals en moure el ratolí o intentar seleccionar text.
- **EXCEPCIÓ**: Cap. Tots els diàlegs han de tenir un botó de tancar $(\text{X})$ o "Cancel·lar" explícit.

### 3.2. Ús de la tecla ESC (Cancel·lar)
- **OBLIGATORI**: La tecla `Escape` ha de tancar el diàleg sempre que estigui obert.
- **IMPLEMENTACIÓ**: Mitjançant un `useEffect` amb `addEventListener('keydown', ...)`.

### 3.3. Ús de la tecla ENTER (Confirmar)
- **OBLIGATORI**: La tecla `Enter` ha d'executar l'acció principal (Acceptar, Guardar, Confirmar).
- **RESTRICCIÓ CRÍTICA**: No s'ha d'executar si el focus està en un element que requereix la tecla Enter per a la seva pròpia lògica (exemple: `textarea`).
- **EXCEPCIÓ**: En diàlegs de cerca o llistes, `Enter` selecciona l'element ressaltat.

## 4. Implementació de referència (React)

```javascript
useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            onClose();
        } else if (e.key === 'Enter') {
            // No confirmar si estem en un textarea
            if (document.activeElement.tagName === 'TEXTAREA') return;
            
            // Opcional: Evitar si és un input però volem un comportament específic
            // e.preventDefault(); 
            onConfirm();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
}, [isOpen, onClose, onConfirm]);
```

## 5. Lliçons apreses
*"Nota: No posar el listener d'esdeveniments al div del modal si aquest no té focus, ja que no capturarà les tecles. Utilitzar sempre window o document per a modals globals."*

---
*Creat el 17 d'abril de 2026 per Antigravity.*
