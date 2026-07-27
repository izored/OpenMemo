// Auto-pick a collection emoji from its name. Shared by the full New Collection
// modal and the inline "create collection" flow in the Add Memo panel so a
// collection made either way gets the same sensible glyph (📁 when nothing hits).

const KEYWORD_EMOJI: [RegExp, string][] = [
  [/\b(code|dev|program|script|software|tech|web|app|api)\b/i, '💻'],
  [/\b(design|ui|ux|figma|sketch|art|creative|graphic)\b/i, '🎨'],
  [/\b(book|read|learn|study|educat|course|class|school)\b/i, '📚'],
  [/\b(money|finance|budget|invest|bank|crypto|stock|wallet)\b/i, '💰'],
  [/\b(travel|trip|vacation|flight|hotel|tour)\b/i, '✈️'],
  [/\b(health|fitness|gym|workout|sport|run|diet|medical)\b/i, '🏋️'],
  [/\b(food|cook|recipe|restaurant|meal|eat|drink)\b/i, '🍕'],
  [/\b(music|song|playlist|album|artist|band|audio|podcast)\b/i, '🎵'],
  [/\b(video|movie|film|tv|series|watch|cinema|youtube)\b/i, '🎬'],
  [/\b(game|gaming|play|esport|steam|xbox|playstation)\b/i, '🎮'],
  [/\b(research|science|lab|experiment|data|analysis)\b/i, '🔬'],
  [/\b(work|job|office|career|business|meeting|project)\b/i, '💼'],
  [/\b(home|personal|life|family|house|daily)\b/i, '🏠'],
  [/\b(social|chat|team|community|friends|network)\b/i, '💬'],
  [/\b(security|crypto|password|vault|key|lock|privacy)\b/i, '🔐'],
  [/\b(photo|image|picture|gallery|camera)\b/i, '📷'],
  [/\b(note|memo|journal|diary|write|blog)\b/i, '📝'],
  [/\b(idea|thought|brain|mind|think|concept)\b/i, '💡'],
  [/\b(star|fav|important|key|main|primary)\b/i, '⭐'],
];

/** Derived emoji, or null when nothing matches. */
export function deriveCollectionEmoji(name: string): string | null {
  for (const [re, emoji] of KEYWORD_EMOJI) {
    if (re.test(name)) return emoji;
  }
  return null;
}

/** Same, but falls back to the default folder glyph so it always returns one. */
export function collectionEmojiOrDefault(name: string): string {
  return deriveCollectionEmoji(name) ?? '📁';
}
