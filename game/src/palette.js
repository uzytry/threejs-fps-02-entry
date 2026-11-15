// The look plan, in one place. Eight values, two team hues; the lighting makes every
// shade the game needs, so no other colour appears in the code. The same names are the
// CSS custom properties in index.html. Amber is EMBER (the attackers, the player's team)
// and teal is ASH (the defenders); danger marks the bomb and damage.
export const PALETTE = {
  canvas: '#16181d',
  surface: '#23262d',
  hairline: '#31363f',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  rival: '#3fb8a6',
  danger: '#e5484d',
};

export function shade(name) {
  return PALETTE[name];
}
