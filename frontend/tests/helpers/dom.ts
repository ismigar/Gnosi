/** Fail at the fixture boundary rather than dereferencing an absent control. */
export function element<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor)) throw new Error(`Missing ${constructor.name}: ${id}`);
  return found;
}

export const node = (id: string): HTMLElement => element(id, HTMLElement);
export const input = (id: string): HTMLInputElement => element(id, HTMLInputElement);
export const textarea = (id: string): HTMLTextAreaElement => element(id, HTMLTextAreaElement);
export const select = (id: string): HTMLSelectElement => element(id, HTMLSelectElement);
export const button = (id: string): HTMLButtonElement => element(id, HTMLButtonElement);

export function option(control: HTMLSelectElement, index: number): HTMLOptionElement {
  const found = control.options.item(index);
  if (!found) throw new Error(`Missing option ${String(index)} in ${control.id}`);
  return found;
}
