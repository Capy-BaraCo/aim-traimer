export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T => root.querySelector(sel) as T;

export const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] =>
  Array.from(root.querySelectorAll(sel)) as T[];

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Delegate clicks on [data-act] elements to handlers. */
export function actions(root: HTMLElement, map: Record<string, (el: HTMLElement, ev: MouseEvent) => void>): void {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el)) return;
    const fn = map[el.dataset.act!];
    if (fn) fn(el, ev);
  });
}

/** Keep a range input's filled track in sync (Chromium has no ::progress pseudo). */
export function syncRange(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const p = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

export const stagger = (root: HTMLElement): void => {
  root.querySelectorAll<HTMLElement>('.rise').forEach((el, i) => el.style.setProperty('--i', String(i)));
};
