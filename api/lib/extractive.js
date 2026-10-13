/**
 * Step 3 Tier 1: Instant & Free Extractive Micro-Summarizer
 * Produces a crisp 1-sentence micro-summary in < 1ms with 0 API cost.
 * Can run seamlessly in both Node.js (Vercel) and Browser (React).
 */

const EXCLUDE_STARTERS = /^(click here|subscribe|read more|advertisement|photo by|source:|by\s+[a-z]+|share this)/i;

/**
 * Splits text into clean individual sentences
 */
export function splitSentences(text) {
  if (!text) return [];
  const clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Protect decimals (e.g., 3.5x, $1.5B) and abbreviations (e.g., U.S., Dr.)
  const safeText = clean
    .replace(/(\d+)\.(\d+)/g, '$1_DECIMAL_$2')
    .replace(/\bU\.S\./g, 'US_DOT')
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof)\./g, '$1_DOT')
    .replace(/\b(e\.g|i\.e)\./g, '$1_DOT');

  const rawMatches = safeText.match(/[^.!?]+[.!?]+/g) || [clean];

  return rawMatches
    .map(s => s.replace(/_DECIMAL_/g, '.').replace(/_DOT/g, '.').trim())
    .filter(s => s.length > 25 && !EXCLUDE_STARTERS.test(s));
}

/**
 * Generates an instant extractive 1-sentence micro-summary using
 * heuristic lead-paragraph analysis & headline-salience scoring.
 */
export function generateExtractiveMicroSummary(title = '', content = '') {
  const cleanTitle = (title || '').replace(/<[^>]*>/g, '').trim();
  const sentences = splitSentences(content);

  if (sentences.length === 0) {
    return cleanTitle ? `${cleanTitle}.` : '';
  }

  // Tokenize title words (ignore short stopwords)
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

    // Ideal micro-summary length: 12 - 35 words
    if (wordCount < 8 || wordCount > 55) return;

    let score = 0;

    // 1. Title keyword overlap (salience)
    words.forEach(w => {
      if (titleWords.has(w)) score += 2.5;
    });

    // 2. Position bias (Journalistic inverted pyramid: lead sentences carry key info)
    if (index === 0) score += 3.0;
    else if (index === 1) score += 1.8;
    else if (index === 2) score += 1.0;

    // 3. Contains numbers or metrics (factual anchor)
    if (/\d+/.test(sentence)) score += 1.0;

    // 4. Length penalty if too short or verbose
    if (wordCount >= 14 && wordCount <= 32) score += 1.5;

    if (score > maxScore) {
      maxScore = score;
      bestSentence = sentence;
    }
  });

  return bestSentence.trim();
}
