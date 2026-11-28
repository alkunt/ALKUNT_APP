// Both automatic filling and the image panel must describe the CURRENT card.
// image.query is only an old visual suggestion; it is not the card's content.
const text = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
export function cardImageContext(deck, card) {
  return {
    deckTitle: text(deck.title, 240),
    topic: text(deck.topic, 600),
    slide: {
      title: text(card.title, 240),
      subtitle: text(card.subtitle, 300),
      body: text(card.body, 1200),
      items: (card.items || []).slice(0, 6).map(item => text([item.title, item.text].filter(Boolean).join(': '), 240)),
    },
  };
}
