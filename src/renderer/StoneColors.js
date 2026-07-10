/**
 * Stone display palette.
 *
 * Rendering-only data: fill/stroke/shine/accent hex values keyed by the same
 * color id a Stone.color carries. This is display metadata, not manufacturing
 * data — StoneLayout itself only knows the color id string. Shared by the
 * canvas renderers and the SVG exporter so there is exactly one definition.
 */

export const STONE_COLORS = {
  crystal: { name: 'Crystal AB', fill: '#e9f7ff', stroke: '#5e7080', shine: '#ffffff', accent: '#92d5ff' },
  gold: { name: 'Gold', fill: '#f3bd32', stroke: '#926400', shine: '#fff1a6', accent: '#d18a00' },
  silver: { name: 'Silver', fill: '#d8dde4', stroke: '#737b86', shine: '#ffffff', accent: '#a7b0bf' },
  jet: { name: 'Jet Black', fill: '#141414', stroke: '#d9d9d9', shine: '#555', accent: '#000' },
  rose: { name: 'Rose', fill: '#ef8fb0', stroke: '#8a2c4d', shine: '#ffe2ed', accent: '#d75384' },
  sapphire: { name: 'Sapphire', fill: '#2269d3', stroke: '#0f356f', shine: '#b8d8ff', accent: '#174ca2' },
  emerald: { name: 'Emerald', fill: '#2aa66a', stroke: '#0b5633', shine: '#c7ffdf', accent: '#16814e' }
};
