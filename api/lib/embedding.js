import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Prepares the fingerprint text: headline + first 150 words of body content
 * This captures the core event/news hook while keeping embedding computation fast and focused.
 */
export function getFingerprintText(title, content) {
  const cleanTitle = (title || '').trim();
  const cleanBody = (content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const words = cleanBody.split(/\s+/).slice(0, 150).join(' ');
  return `${cleanTitle}. ${words}`.trim();
}

/**
 * Generates a 768-dimensional semantic embedding vector using Gemini text-embedding-004
 */
export async function generateHeadlineEmbedding(text, apiKey) {
  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is required to generate embeddings');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  // Limit input to first 1000 characters for speed and focus
  const truncatedText = text.slice(0, 1000);
  const result = await model.embedContent(truncatedText);

  if (!result || !result.embedding || !result.embedding.values) {
    throw new Error('Failed to generate embedding vector from Gemini');
  }

  return result.embedding.values;
}

/**
 * Computes cosine similarity between two numeric vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
