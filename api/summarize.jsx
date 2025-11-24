// This file belongs in the /api folder of your project.
// e.g., my-rssmindly-app/api/summarize.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// These variables come from your Vercel Environment Variables settings
// Do NOT hardcode them here if you commit to GitHub!
const GOOGLE_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize Clients
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  // 1. Basic Security & Validation
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { articleUrl, title, content } = req.body;

  if (!articleUrl || !content) {
    return res.status(400).json({ error: 'Missing required fields: articleUrl or content' });
  }

  try {
    // 2. SMART CACHE: Check Supabase before paying for AI
    // We search by the unique article URL
    const { data: cachedSummary, error: cacheError } = await supabase
      .from('summaries')
      .select('text')
      .eq('url', articleUrl)
      .single();

    if (cachedSummary) {
      // Cache Hit! Return immediately.
      return res.status(200).json({ summary: cachedSummary.text, source: 'cache' });
    }

    // 3. CACHE MISS: Call Google Gemini API
    // Use 'gemini-1.5-flash' for speed and low cost
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Summarize this news article in 2-3 concise bullet points. 
    Output valid HTML using <ul> and <li> tags only. Do not use markdown.
    Title: ${title}
    Content: ${content}`;

    const result = await model.generateContent(prompt);
    const summaryText = result.response.text();

    // 4. SAVE TO CACHE
    // Save the result so future users get it for free
    await supabase.from('summaries').insert({
      url: articleUrl,
      text: summaryText,
      created_at: new Date().toISOString()
    });

    return res.status(200).json({ summary: summaryText, source: 'ai' });

  } catch (error) {
    console.error('Summarization failed:', error);
    return res.status(500).json({ error: 'Failed to generate summary', details: error.message });
  }
}