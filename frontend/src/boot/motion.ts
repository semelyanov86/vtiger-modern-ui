/**
 * The scroll behaviour and the reorder animation of the theme for the motion preference of the person
 * (prefers-reduced-motion: reduce — no smooth scrolling, no sliding of dragged entries). CSS transitions of the theme
 * follow the same preference in styles/_tokens.scss (mixin transition).
 */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth'
}

/** Milliseconds of the SortableJS animation when entries are reordered. */
export function reorderAnimation(): number {
  return reducedMotion() ? 0 : 150
}
