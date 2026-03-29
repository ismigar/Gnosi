# Directive: Gantt Chart Dependencies & Date Recalculation

## Context
Implementing Microsoft Project style dependencies (predecessors/successors) in a horizontal Gantt chart within the Digital Brain.

## Successes
- **Partial Updates (PATCH)**: Using `PATCH` instead of `PUT` for metadata updates prevents `422 Unprocessable Entity` errors when the full note object (title, content) is not readily available or needed.
- **Recursive Propagation**: Implementing a depth-first search (DFS) style recalculation ensured that shifting one task correctly propagates through the entire dependency chain.
- **Visual Links**: Drawing simple absolute-positioned lines between connected bars provides immediate visual feedback of project flow.

## Lessons Learned & Mistakes
- **Avoid Full Body Updates**: Initially, `handleUpdateNote` used `PUT`, which required `title` and `content`. Since the Gantt view only deals with metadata, this failed. Always implement `PATCH` for metadata-only updates.
- **Recursive Infinite Loops**: When implementing date recalculation, ensure there's a check to prevent cyclic dependencies (though simple timestamp checks usually prevent this by only moving forward, a explicit loop check is safer).
- **Date Normalization**: React state might use different date formats. Ensure consistent `ISOString` or `Date` objects when comparing or sending to the backend.

## Implementation Standard
1. **Schema**: Store dependencies in `metadata.predecessor_ids` as an array of IDs.
2. **Recalculation**:
   - Trigger when a predecessor date changes.
   - New Start = Predecessor End.
   - Maintain successor duration.
   - Recurse for all successors of the updated task.
3. **Backend**: Use `router.patch` in `vault_routes.py` to merge metadata dictionaries without requiring the full markdown body.

## Restrictions
- **Cyclic Dependencies**: Current UI does not prevent creating cycles, but the algorithm only shifts forward.
- **Batch Updates**: Current implementation saves each affected note in individual API calls. For long chains, consider a batch update endpoint.
