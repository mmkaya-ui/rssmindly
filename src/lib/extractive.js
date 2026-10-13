/**
 * Tier 1: Instant & Free Extractive Micro-Summarizer (Client-Side 0ms Preview)
 */

export function splitSentences(text) {
  if (!text) return [];
  const clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const safeText = clean
    .replace(/(\d+)\.(\d+)/g, '$1_DECIMAL_$2')
    .replace(/\bU\.S\./g, 'US_DOT')
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof)\./g, '$1_DOT')
    .replace(/\b(e\.g|i\.e)\./g, '$1_DOT');

  const rawMatches = safeText.match(/[^.!?]+[.!?]+/g) || [clean];

  return rawMatches
    .map(s => s.replace(/_DECIMAL_/g, '.').replace(/_DOT/g, '.').trim())
    .filter(s => s.length > 25 && !/^(click here|subscribe|read more|advertisement|photo by|source:|by\s+[a-z]+)/i.test(s));
}

export function generateExtractiveMicroSummary(title = '', content = '') {
  const cleanTitle = (title || '').replace(/<[^>]*>/g, '').trim();
  const sentences = splitSentences(content);

  if (sentences.length === 0) {
    return cleanTitle ? `${cleanTitle}.` : '';
  }

  const titleWords = new Set(
    cleanTitle
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3)
  );

  let bestSentence = sentences[0];
  let maxScore = -1;

  sentences.slice(0, 5).forEach((sentence, index) => {
    const words = sentence.toLowerCase().split(/\W+/);
    const wordCount = words.length;

    if (wordCount < 8 || wordCount > 55) return;

    let score = 0;
    words.forEach(w => {
      if (titleWords.has(w)) score += 2.5;
    });

    if (index === 0) score += 3.0;
    else if (index === 1) score += 1.8;
    else if (index === 2) score += 1.0;

    if (/\d+/.test(sentence)) score += 1.0;
    if (wordCount >= 14 && wordCount <= 32) score += 1.5;

    if (score > maxScore) {
      maxScore = score;
      bestSentence = sentence;
    }
  });

  return bestSentence.trim();
}
