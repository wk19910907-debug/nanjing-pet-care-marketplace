type Bounds = { left: number; top: number; width: number; height: number };

const clamp = (value: number) => Math.max(-8, Math.min(8, Math.round(value)));

export function calculateHeroParallax(pointerX: number, pointerY: number, bounds: Bounds) {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp((((pointerX - bounds.left) / bounds.width) - 0.5) * 16),
    y: clamp((((pointerY - bounds.top) / bounds.height) - 0.5) * 16),
  };
}
