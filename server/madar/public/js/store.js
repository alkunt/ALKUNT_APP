// Local library (this browser only) and the undo/redo history of the open deck.

const SCOPE = document.documentElement.dataset.madarAccount;
if (!SCOPE) throw new Error('Madar requires an authenticated account');
const INDEX = 'madar:' + SCOPE + ':index';
const KEY = (id) => `madar:${SCOPE}:deck:${id}`;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listDecks() {
  return read(INDEX, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadDeck(id) {
  return read(KEY(id), null);
}

export function saveDeck(deck) {
  deck.updatedAt = Date.now();
  const ok = write(KEY(deck.id), deck);
  const idx = read(INDEX, []).filter((d) => d.id !== deck.id);
  const cover = deck.cards[0];
  idx.push({
    id: deck.id,
    title: deck.title || 'بدون عنوان',
    format: deck.format,
    theme: deck.theme,
    customTheme: deck.customTheme,
    cards: deck.cards.length,
    cover: cover ? { title: cover.title, layout: cover.layout, image: cover.image?.url || '' } : null,
    updatedAt: deck.updatedAt,
    shareId: deck.share?.id || '',
  });
  write(INDEX, idx);
  return ok;
}

export function deleteDeck(id) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
  write(INDEX, read(INDEX, []).filter((d) => d.id !== id));
}

export function getPref(name, fallback) {
  return read(`madar:${SCOPE}:pref:${name}`, fallback);
}
export function setPref(name, value) {
  write(`madar:${SCOPE}:pref:${name}`, value);
}

// ---------- history ----------

export class History {
  constructor(limit = 60) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  snapshot(deck) {
    this.past.push(typeof deck === 'string' ? deck : JSON.stringify(deck));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  canUndo() {
    return this.past.length > 0;
  }
  canRedo() {
    return this.future.length > 0;
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop());
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(this.future.pop());
  }
}
