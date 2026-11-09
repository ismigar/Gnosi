import groups from './color-tokens.json' with {type:'json'};

// Regional assignments are opt-in; existing sites retain their original CSS.
export function colorAssignments(theme) {
  return groups.flatMap(group=>group.tokens).filter(token=>token.selectors && theme.tokens[token.key]?.trim()).map(token=>
    `${token.selectors.join(',')}{${token.property}:var(--${token.key})}`
  ).join('\n');
}
