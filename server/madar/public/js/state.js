import { logoElement } from './logo.js';

// Shared app state, plus the navigate() function registered by app.js.

export const state = {
  request: null, // the creation request from the home screen
  outline: null, // the outline being reviewed
  generation: null, // pending deck generation, picked up by the editor
  pendingDeck: null, // a deck handed to the editor before it is saved
  navigate: () => {},
};

export const BRAND = {
  name: 'مدار',
  by: 'من منصة الكونت',
  siteUrl: '/?view=madar',
  siteLabel: 'أركان العنزي · منصة الكونت',
};

export function brandMark(size = 34) {
  return logoElement({ size, tile: true });
}
