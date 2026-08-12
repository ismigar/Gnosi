# Block editor table theme

## Objective

Keep native BlockNote tables readable in every Gnosi color theme.

## Directive

Table header backgrounds and foregrounds must use Gnosi theme tokens. Use
`--bg-tertiary` for the default header background and `--text-primary` for its
text. Apply both declarations to the header cell because descendants inherit
the editor foreground color.

## Restrictions and edge cases

- Do not use a fixed light header background without a matching foreground;
  it causes white-on-light text in dark mode.
- Keep the selector scoped to native BlockNote table blocks so database views
  and other application tables retain their own visual system.
- Verify both the rendered header and the body cells in dark mode after a full
  page reload.
