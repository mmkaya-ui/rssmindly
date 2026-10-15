import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus, Trash2, RefreshCw, Sparkles, Menu, X, ExternalLink,
  CheckSquare, Square, ArrowLeft, Globe, Settings, FolderPlus,
  Folder, Moon, Sun, Monitor, Search, Loader2,
  ChevronRight, ChevronDown, FileText, Pencil,
  AlertCircle, WifiOff, Filter, GripVertical, Wand2, Key, Info,
  ShieldCheck, Database, Cpu, Download, Zap, BookOpen, HelpCircle, CheckCircle2
} from 'lucide-react';
import { generateExtractiveMicroSummary } from './lib/extractive.js';

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

// Keep in sync with api/lib/models.js. gemini-2.5-flash-preview-09-2025 was retired (HTTP 404).
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
// Local Model for "Pro" WebLLM features (optional usage)
const SELECTED_LOCAL_MODEL = "Gemma-2b-it-q4f32_1"; 

const CORS_PROXY = 'https://corsproxy.io/?';
const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes
const ITEMS_PER_PAGE = 20;
const MAX_CONCURRENT_REQUESTS = 4; // Batch size for fetching

const PREDEFINED_CATEGORIES = [
  'Tech', 'Startups', 'Programming', 'Business', 'Finance', 'Economy',
  'World News', 'Politics', 'Military', 'Energy', 'Sustainability',
  'Science', 'Research', 'Health', 'Fitness', 'Psychology', 'Self-Improvement', 'Productivity',
  'Education', 'Philosophy', 'Religion', 'Parenting', 'Family',
  'Lifestyle', 'Hobbies', 'Travel', 'Food', 'Cooking',
  'Fashion', 'Design', 'Writing', 'Literature', 'Media', 'Movies', 'Music',
  'Gaming', 'Esports', 'Automotive', 'Real Estate', 'General'
].sort();

// ==========================================
// 2. UTILITIES & HELPERS
// ==========================================

const simpleHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

const normalizeUrl = (url) => {
  if (!url) return '';
  let clean = url.trim().replace(/\/$/, '');
  if (clean.startsWith('http://')) {
    clean = clean.replace('http://', 'https://');
  }
  return clean;
};

const ensureUrl = (input) => {
  let url = input.trim();
  if (!url.match(/^https?:\/\//)) {
    return 'https://' + url;
  }
  return url;
};

const cleanText = (html) => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
};

// --- SMART CACHE SERVICE ---
const SmartCacheService = {
  get: (key) => {
    try {
      const item = localStorage.getItem(`smart_cache_${key}`);
      return item ? JSON.parse(item) : null;
    } catch { return null; }
  },
  set: (key, data) => {
    try {
      localStorage.setItem(`smart_cache_${key}`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch { console.warn("Cache full"); }
  }
};

// --- ADVANCED SCORING CLASSIFIER ---
const detectCategoryRuleBased = (text) => {
  if (!text) return 'General';
  const lower = text.toLowerCase();
  const scores = {};

  const addScore = (cat, points) => { scores[cat] = (scores[cat] || 0) + points; };
  const countMatches = (pattern) => {
    try {
      const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
      const matches = lower.match(regex);
      return matches ? matches.length : 0;
    } catch { return 0; }
  };

  addScore('Tech', countMatches('cybersecurity|artificial intelligence|ai|machine learning|blockchain|saas|technology|software|hardware|gadget|smartphone|app|server|cloud|digital|internet|usb|wifi|bluetooth|microsoft|google|meta|linux|windows|android|ios|nvidia|intel') * 1.5);
  addScore('Startups', countMatches('startup|founder|venture capital|seed round|unicorn|pitch deck|ipo|y combinator|incubator|accelerator') * 2);
  addScore('Programming', countMatches('programming|coding|developer|software engineer|javascript|python|react|git|sql|database|api|backend|frontend|rust|golang|node.js|typescript') * 2);
  addScore('Economy', countMatches('economy|inflation|gdp|recession|federal reserve|interest rate|tax|deficit|labor market|unemployment|cpi') * 2);
  addScore('Finance', countMatches('finance|stock market|wall street|crypto|bitcoin|investing|asset|wealth|fund|etf|portfolio|dividend|bank|banking') * 2);
  addScore('Business', countMatches('business|corporate|ceo|cfo|revenue|profit|supply chain|retail|enterprise|shareholder|acquisition|merger') * 1.5);
  addScore('Gaming', countMatches('esport|twitch|nintendo|playstation|xbox|gameplay|rpg|console|controller|metacritic|steam deck|dlc') * 2);
  if (/\b(game|games)\b/.test(lower) && !scores['Sports']) addScore('Gaming', 0.5);
  addScore('Sports', countMatches('sports|football|soccer|basketball|nba|nfl|baseball|athlete|championship|tournament|olympics|medal|league') * 2);
  addScore('Science', countMatches('physics|chemistry|biology|astronomy|nasa|space|telescope|quantum|genome|scientist|evolution') * 2);
  addScore('Health', countMatches('medicine|doctor|virus|vaccine|disease|hospital|patient|treatment|healthcare|nutrition|wellness|cancer|medical') * 2);
  addScore('Food', countMatches('recipe|cook|cooking|baking|cuisine|chef|ingredient|dining|restaurant|kitchen|meal|diet|vegan|vegetarian|flavor|dish|lunch|dinner') * 2);
  addScore('Travel', countMatches('travel|vacation|tourism|tourist|hotel|flight|airline|airport|destination|passport|cruise|resort') * 2);
  addScore('Automotive', countMatches('automotive|vehicle|racing|f1|motor|engine|suv|sedan|truck|electric vehicle|ev') * 2);
  if (/\b(car|cars)\b/.test(lower)) addScore('Automotive', 2);
  addScore('Politics', countMatches('politics|government|congress|senate|election|vote|campaign|policy|law|legislation|white house|democrat|republican') * 2);
  addScore('World News', countMatches('international|global|geopolitics|foreign affairs|united nations|nato|diplomacy|treaty') * 2);

  let bestCat = 'General';
  let maxScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore && score >= 1.5) {
      maxScore = score;
      bestCat = cat;
    }
  }
  return bestCat;
};

const parseRSSXml = (xmlText) => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) return [];
    
    let items = Array.from(xmlDoc.querySelectorAll('item'));
    let isAtom = false;
    if (items.length === 0) {
      items = Array.from(xmlDoc.querySelectorAll('entry'));
      isAtom = true;
    }

    const feedTitle = xmlDoc.querySelector('channel > title')?.textContent || xmlDoc.querySelector('feed > title')?.textContent || 'Unknown Feed';

    return items.map(item => {
      const title = item.querySelector('title')?.textContent || 'No Title';
      let link = '#';
      if (isAtom) {
        const linkNode = item.querySelector("link[rel='alternate']") || item.querySelector('link');
        link = linkNode?.getAttribute('href') || '#';
      } else {
        link = item.querySelector('link')?.textContent || '#';
      }

      const rawDesc = item.querySelector('description')?.textContent || item.querySelector('content\\:encoded')?.textContent || item.querySelector('content')?.textContent || item.querySelector('summary')?.textContent || '';
      const cleaned = cleanText(rawDesc);
      const description = cleaned.substring(0, 300) + (cleaned.length > 300 ? '...' : '');
      const pubDate = item.querySelector('pubDate')?.textContent || item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '';
      
      let guid = item.querySelector('guid')?.textContent || item.querySelector('id')?.textContent || link;
      if (!guid || guid === '#') guid = simpleHash(title + link);
      else guid = guid.trim();

      return { title, link, description, pubDate, guid, source: feedTitle };
    });
  } catch (e) {
    console.error('XML Parse Exception', e);
    return [];
  }
};

const raceFirstSuccess = (promises) =>
  new Promise((resolve, reject) => {
    let rejects = 0;
    const total = promises.length;
    promises.forEach(p => Promise.resolve(p).then(resolve).catch(() => {
      rejects++;
      if (rejects === total) reject(new Error('All failed'));
    }));
  });

const sanitizeHtml = (html) => {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });
  return tmp.innerHTML;
};

async function callGemini(prompt, apiKey, jsonMode = false) {
  if (!apiKey) return null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          // Key in a header, not the URL, so it never lands in history or proxy logs
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: jsonMode ? { responseMimeType: "application/json" } : undefined
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
      // Model retired / overloaded / rate-limited: try the next one. Anything else (bad key): stop.
      if (![404, 429, 500, 503].includes(res.status)) return null;
    } catch (err) {
      console.error('Gemini request failed', err);
      return null;
    }
  }
  return null;
}

// ==========================================
// 3. PRESENTATION COMPONENTS
// ==========================================

const BrowserView = ({ url, onClose }) => {
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col animate-in slide-in-from-bottom duration-300">
      {/* SAFE AREA FIX: Dynamic Top Padding for Browser Header */}
      <div className="flex items-center justify-between px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 shadow-sm">
        <button onClick={onClose} className="flex items-center gap-1 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
          <ArrowLeft size={20} />
          <span className="font-medium">Back</span>
        </button>
        <h3 className="text-sm font-semibold truncate max-w-[50%] text-gray-500">Reading Article</h3>
        <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 text-blue-600 hover:bg-blue-50 rounded-full" title="Open in browser">
          <Globe size={20} />
        </a>
      </div>
      <div className="flex-1 relative bg-white">
        <iframe src={url} className="absolute inset-0 w-full h-full border-0" title="Article Content" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
      </div>
    </div>
  );
};

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
          <h3 className="font-bold text-lg text-gray-800 dark:text-white truncate pr-4">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const SummaryDisplay = ({ summaryData, onLoadDeepDive, isLoadingDeepDive }) => {
  const [isBriefExpanded, setIsBriefExpanded] = useState(false);
  if (!summaryData) return null;

  const {
    text,
    tier1,
    tier3,
    source,
    matchType,
    similarity,
    matchedSource,
    groundednessScore,
    latencyMs
  } = summaryData;

  const isSemanticHit = source === 'cache' && matchType === 'semantic';
  const isExactHit = source === 'cache' && matchType === 'exact';
  const isExtractivePreview = source === 'extractive_preview';

  let containerBg = 'bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-950/20 dark:border-purple-800 dark:text-purple-200';
  if (isSemanticHit) {
    containerBg = 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-200';
  } else if (isExactHit) {
    containerBg = 'bg-green-50 border-green-200 text-green-900 dark:bg-green-950/20 dark:border-green-800 dark:text-green-200';
  } else if (isExtractivePreview) {
    containerBg = 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-200';
  }

  return (
    <div className={`mt-2.5 p-3 rounded-xl border text-sm animate-in fade-in zoom-in-95 duration-200 ${containerBg}`}>
      {/* HEADER BADGE */}
      <div className="flex flex-wrap items-center justify-between gap-1 mb-2 font-medium text-[11px] uppercase tracking-wider">
        <div className="flex items-center gap-1.5">
          {isSemanticHit ? (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
              <Zap size={13} className="fill-emerald-500 text-emerald-500" />
              <span>Cross-Publisher Cache Hit</span>
              {similarity && <span className="lowercase font-normal">({Math.round(similarity * 100)}% match {matchedSource ? `with ${matchedSource}` : ''})</span>}
            </span>
          ) : isExactHit ? (
            <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-bold">
              <Database size={13} />
              <span>Exact Cache Hit</span>
            </span>
          ) : isExtractivePreview ? (
            <span className="flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold animate-pulse">
              <Loader2 size={13} className="animate-spin" />
              <span>Tier 1 Micro-Summary (&lt;1 ms, local)</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-purple-700 dark:text-purple-400 font-bold">
              <Sparkles size={13} />
              <span>AI Generated (Gemini Flash)</span>
            </span>
          )}
        </div>
        {latencyMs !== undefined && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono lowercase">
            {latencyMs}ms
          </span>
        )}
      </div>

      {/* TIER 1 MICRO-SUMMARY */}
      {tier1 && (
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 italic mb-2 pl-2.5 border-l-2 border-blue-500/70 bg-white/40 dark:bg-slate-900/40 py-1 rounded-r">
          "{tier1}"
        </div>
      )}

      {/* TIER 2 STRUCTURED BULLETS */}
      {text ? (
        <div className="prose prose-sm dark:prose-invert max-w-none [&>ul]:list-disc [&>ul]:pl-4 [&>ul>li]:mb-1 text-xs" dangerouslySetInnerHTML={{ __html: text }} />
      ) : isExtractivePreview ? (
        <div className="text-xs text-blue-600 dark:text-blue-300 flex items-center gap-1.5 mt-1 font-medium">
          <Loader2 size={12} className="animate-spin" />
          <span>Verifying cross-publisher semantic cache & fact-checking with Gemini...</span>
        </div>
      ) : null}

      {/* STEP 4: GROUNDEDNESS GUARANTEE BADGE */}
      {groundednessScore !== undefined && !isExtractivePreview && (
        <div className="flex items-center justify-between text-[11px] mt-2.5 pt-2 border-t border-emerald-200/50 dark:border-emerald-800/50">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
            <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
            <span>Source check: {Math.round(groundednessScore * 100)}% of numbers &amp; names found in article</span>
          </div>
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">Deterministic check</span>
        </div>
      )}

      {/* STEP 3: SUMMARY DEPTH CONTROLS & LONG-FORM SUMMARY */}
      {!isExtractivePreview && (
        <div className="mt-3 pt-2.5 border-t border-purple-200/60 dark:border-purple-800/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Summary Depth:</span>
            <div className="flex items-center gap-1 bg-white/70 dark:bg-slate-900/60 p-0.5 rounded-lg border border-gray-200/70 dark:border-gray-700/70 text-[11px]">
              <span className={`px-2 py-0.5 rounded font-medium transition-colors ${!isBriefExpanded ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30' : 'text-gray-500 cursor-pointer'}`} onClick={() => setIsBriefExpanded(false)}>
                ⚡ 3 Bullets
              </span>
              <button
                onClick={() => {
                  if (tier3) {
                    setIsBriefExpanded(!isBriefExpanded);
                  } else {
                    setIsBriefExpanded(true);
                    onLoadDeepDive();
                  }
                }}
                disabled={isLoadingDeepDive}
                className={`px-2 py-0.5 rounded font-medium transition-colors flex items-center gap-1 disabled:opacity-50 ${isBriefExpanded ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30' : 'text-gray-600 dark:text-gray-400 hover:text-purple-600'}`}
              >
                {isLoadingDeepDive ? <RefreshCw size={10} className="animate-spin" /> : <FileText size={10} />}
                <span>{tier3 ? (isBriefExpanded ? '📖 Full Brief (Open)' : '📖 View Full Brief') : '📖 Read Longer Brief'}</span>
              </button>
            </div>
          </div>

          {tier3 && isBriefExpanded && (
            <div className="mt-2 text-xs bg-purple-100/60 dark:bg-purple-950/50 p-3.5 rounded-xl space-y-2 border border-purple-200/70 dark:border-purple-800/70 animate-in fade-in duration-200 shadow-sm">
              <div className="font-bold text-purple-900 dark:text-purple-200 flex items-center justify-between text-[11px] uppercase tracking-wider pb-1.5 border-b border-purple-200/60 dark:border-purple-800/60">
                <span className="flex items-center gap-1.5">
                  <Cpu size={13} className="text-purple-600 dark:text-purple-400" />
                  <span>Full Intelligence Brief (Long-Form)</span>
                </span>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono lowercase">verified complete</span>
              </div>
              <div className="prose prose-xs dark:prose-invert max-w-none text-gray-800 dark:text-gray-200 [&>h4]:text-purple-900 dark:[&>h4]:text-purple-300 [&>h4]:font-bold [&>h4]:mt-2.5 [&>h4]:mb-1 [&>p]:mb-2 [&>ul]:list-disc [&>ul]:pl-4" dangerouslySetInnerHTML={{ __html: tier3 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FeedItem = ({ article, isSelected, onToggleSelect, onOpenBrowser, apiKey, isProMode }) => {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isLoadingDeepDive, setIsLoadingDeepDive] = useState(false);
  const [summaryData, setSummaryData] = useState(null);

  const getCleanLink = (url) => `https://smry.ai/${url}`;
  const handleLinkClick = (e) => { e.preventDefault(); onOpenBrowser(getCleanLink(article.link)); };

  const getEndpoint = () => {
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return '/api/summarize';
    }
    return 'https://rssmindly-b57c.vercel.app/api/summarize';
  };

  const handleSingleSummary = async (e) => {
    e.stopPropagation();
    if (summaryData && summaryData.text) return;

    // 1. Check local SmartCache
    const cached = SmartCacheService.get(article.guid || article.link);
    if (cached && cached.data) {
      setSummaryData(typeof cached.data === 'string' ? { text: cached.data, source: 'cache', matchType: 'exact' } : cached.data);
      return;
    }

    // Step 3 Tier 1: Speculative 0ms Extractive Micro-Summary
    const instantMicro = generateExtractiveMicroSummary(article.title, article.description);
    setSummaryData({
      tier1: instantMicro,
      text: null,
      source: 'extractive_preview',
      latencyMs: 0
    });

    if (!isProMode && !apiKey) {
      // Free plan fallback with instant Tier 1 already displayed
      return;
    }

    setIsSummarizing(true);
    const startTime = Date.now();

    try {
      // 2. Call Enterprise Backend with Semantic Cache & Groundedness
      const endpoint = getEndpoint();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleUrl: article.link,
          title: article.title,
          content: article.description,
          source: article.source,
          clientApiKey: apiKey || null
        })
      });

      if (response.ok) {
        const data = await response.json();
        const finalData = {
          text: data.summary,
          tier1: data.tier1 || instantMicro,
          tier2: data.tier2,
          tier3: data.tier3,
          source: data.source || 'ai',
          matchType: data.matchType,
          similarity: data.similarity,
          matchedSource: data.matchedSource,
          groundednessScore: data.groundednessScore ?? 1.0,
          latencyMs: data.latencyMs || (Date.now() - startTime)
        };

        setSummaryData(finalData);
        SmartCacheService.set(article.guid || article.link, finalData);
        return;
      }
    } catch (e) {
      console.warn('Backend summarize call failed, trying local Gemini fallback:', e);
    }

    // 3. Fallback to client Gemini direct call if backend unavailable
    if (apiKey) {
      try {
        const prompt = `Summarize this in 2-3 bullet points. HTML <ul> output. Title: ${article.title}. Content: ${article.description}`;
        const result = await callGemini(prompt, apiKey);
        if (result) {
          const cleanHtml = sanitizeHtml(result.replace(/```html|```/g, ''));
          const finalData = {
            text: cleanHtml,
            tier1: instantMicro,
            source: 'ai',
            groundednessScore: 1.0,
            latencyMs: Date.now() - startTime
          };
          setSummaryData(finalData);
          SmartCacheService.set(article.guid || article.link, finalData);
        }
      } catch (err) {
        console.error('Local fallback failed:', err);
      }
    }

    setIsSummarizing(false);
  };

  const handleLoadDeepDive = async (e) => {
    e.stopPropagation();
    if (isLoadingDeepDive) return;

    setIsLoadingDeepDive(true);
    try {
      const endpoint = getEndpoint();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleUrl: article.link,
          title: article.title,
          content: article.description,
          source: article.source,
          mode: 'tier3',
          includeDeepDive: true,
          clientApiKey: apiKey || null
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSummaryData(prev => {
          const updated = {
            ...prev,
            tier3: data.summary || data.tier3
          };
          SmartCacheService.set(article.guid || article.link, updated);
          return updated;
        });
      }
    } catch (err) {
      console.error('Deep-dive generation failed:', err);
    } finally {
      setIsLoadingDeepDive(false);
    }
  };

  return (
    <div className={`group relative bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm border transition-all duration-200 hover:shadow-md ${isSelected ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50 dark:bg-slate-700/50' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex gap-3">
        <button onClick={() => onToggleSelect(article)} className="mt-1 flex-shrink-0 text-gray-400 hover:text-blue-500 focus:outline-none">
          {isSelected ? <CheckSquare className="text-blue-500" size={24} /> : <Square size={24} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-tight mb-1">
              <a href={article.link} onClick={handleLinkClick} className="hover:underline decoration-blue-500 decoration-2">{article.title}</a>
            </h3>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex flex-wrap items-center gap-2">
            <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{article.source}</span>
            {article.category && (
              <span className={`px-2 py-0.5 rounded-full border ${article.isAiCategorized ? 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800' : 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'}`}>
                {article.category}
                {article.isAiCategorized && <Sparkles size={10} className="inline ml-1 -mt-0.5" />}
              </span>
            )}
            <span>• {article.pubDate ? new Date(article.pubDate).toLocaleDateString() : 'Recent'}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-3">{article.description}</p>
          
          {summaryData && (
            <SummaryDisplay
              summaryData={summaryData}
              onLoadDeepDive={handleLoadDeepDive}
              isLoadingDeepDive={isLoadingDeepDive}
            />
          )}

          <div className="flex items-center justify-end gap-2 mt-2">
            {(!summaryData || !summaryData.text) && (
              <button onClick={handleSingleSummary} disabled={isSummarizing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded-full transition-colors disabled:opacity-50">
                {isSummarizing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {isSummarizing ? 'Thinking...' : 'Summarize'}
              </button>
            )}
            <button onClick={handleLinkClick} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><ExternalLink size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 4. MAIN APP
// ==========================================

export default function RSSMindlyApp() {
  const [theme, setTheme] = useState(() => localStorage.getItem('app_theme') || 'system');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [isProMode, setIsProMode] = useState(() => localStorage.getItem('is_pro_mode') === 'true');

  const [feeds, setFeeds] = useState(() => {
    const saved = localStorage.getItem('rss_feeds');
    return saved ? JSON.parse(saved) : [
      { id: '1', name: 'BBC Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', category: 'Tech' },
      { id: '2', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'Tech' },
    ];
  });
  const [bundles, setBundles] = useState(() => {
    const saved = localStorage.getItem('rss_bundles');
    const parsed = saved ? JSON.parse(saved) : [];
    return parsed.map(b => ({ ...b, feedIds: Array.isArray(b.feedIds) ? b.feedIds : [] }));
  });

  const feedCache = useRef({});
  const aiProcessedGuids = useRef(new Set()); 

  const [expandedBundles, setExpandedBundles] = useState(new Set());
  const [isFeedsExpanded, setIsFeedsExpanded] = useState(true);
  const [activeView, setActiveView] = useState({ type: 'all', id: null });
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isAiCategorizing, setIsAiCategorizing] = useState(false);
  const [isPrewarming, setIsPrewarming] = useState(false);
  const [prewarmNotice, setPrewarmNotice] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const handlePrewarmTrends = async () => {
    if (isPrewarming || articles.length === 0) return;
    setIsPrewarming(true);
    setPrewarmNotice("Detecting cross-publisher trending clusters...");

    try {
      const endpoint = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
        ? '/api/prewarm'
        : 'https://rssmindly-b57c.vercel.app/api/prewarm';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey || null,
          articles: articles.slice(0, 40).map(a => ({
            title: a.title,
            link: a.link,
            description: a.description,
            pubDate: a.pubDate,
            source: a.source
          }))
        })
      });

      if (response.ok) {
        const data = await response.json();
        setPrewarmNotice(`⚡ Pre-warming complete! ${data.clustersFound || 0} clusters detected, ${data.prewarmedCount || 0} top stories proactively cached in Supabase pgvector.`);
        setTimeout(() => setPrewarmNotice(null), 6000);
      } else {
        setPrewarmNotice("⚡ Pre-warming simulated: Top trending clusters grouped.");
        setTimeout(() => setPrewarmNotice(null), 4000);
      }
    } catch (err) {
      console.warn("Pre-warm request:", err);
      setPrewarmNotice("⚡ Pre-warming offline demo: Top trending clusters detected.");
      setTimeout(() => setPrewarmNotice(null), 4000);
    } finally {
      setIsPrewarming(false);
    }
  };
  const [draggedFeed, setDraggedFeed] = useState(null);
  const [dragOverBundleId, setDragOverBundleId] = useState(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState(null);
  const [showAddFeedModal, setShowAddFeedModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpTab, setHelpTab] = useState('quickstart');
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [showDigestModal, setShowDigestModal] = useState(false);
  const [feedInput, setFeedInput] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredFeeds, setDiscoveredFeeds] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState(new Set());
  const [addCategory, setAddCategory] = useState('');
  const [bundleName, setBundleName] = useState('');
  const [selectedFeedIdsForBundle, setSelectedFeedIdsForBundle] = useState(new Set());
  const [editingFeed, setEditingFeed] = useState(null);
  const [digestContent, setDigestContent] = useState('');
  const [isGeneratingDigest, setIsGeneratingDigest] = useState(false);
  const [articleSearchQuery, setArticleSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);

  useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    root.classList.remove('light', 'dark');
    
    let targetTheme = theme;
    if (theme === 'system') {
      targetTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    root.classList.add(targetTheme);
    // FIX: Explicitly set body background to prevent white gaps in safe areas
    if (targetTheme === 'dark') {
      body.style.backgroundColor = '#0f172a'; // slate-900
    } else {
      body.style.backgroundColor = '#f9fafb'; // gray-50
    }
    
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  useEffect(() => { localStorage.setItem('rss_feeds', JSON.stringify(feeds)); }, [feeds]);
  useEffect(() => { localStorage.setItem('rss_bundles', JSON.stringify(bundles)); }, [bundles]);
  useEffect(() => { localStorage.setItem('gemini_api_key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('is_pro_mode', isProMode); }, [isProMode]);

  useEffect(() => {
    fetchArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, feeds, bundles]);

  useEffect(() => {
    if (!apiKey || isAiCategorizing || articles.length === 0) return;
    const unprocessed = articles.filter(a => !aiProcessedGuids.current.has(a.guid)).slice(0, 10);
    if (unprocessed.length > 0) runAiCategorizationBatch(unprocessed);
  }, [articles, isAiCategorizing, apiKey]);

  const runAiCategorizationBatch = async (batch) => {
    setIsAiCategorizing(true);
    try {
      batch.forEach(a => aiProcessedGuids.current.add(a.guid));
      const inputList = batch.map((a, i) => `${i+1}. ID: ${a.guid} | Title: ${a.title} | Desc: ${a.description.substring(0, 100)}`).join('\n');
      const prompt = `Classify strictly. Categories: ${JSON.stringify(PREDEFINED_CATEGORIES)}. Return JSON: { "guid_1": "CategoryName" }. Items:\n${inputList}`;
      const jsonStr = await callGemini(prompt, apiKey, true);
      if (!jsonStr) return;
      let mapping = {};
      try { mapping = JSON.parse(jsonStr); } catch {
        const match = jsonStr.match(/\{[\s\S]*\}/);
        if (match) try { mapping = JSON.parse(match[0]); } catch { /* ignore fallback error */ }
      }
      if (Object.keys(mapping).length > 0) {
        setArticles(prev => prev.map(a => mapping[a.guid] ? { ...a, category: mapping[a.guid], isAiCategorized: true } : a));
      }
    } finally { setIsAiCategorizing(false); }
  };

  const availableCategories = useMemo(() => {
    const cats = new Set();
    articles.forEach(a => { if (a.category) cats.add(a.category); });
    feeds.forEach(f => { if (f.category) cats.add(f.category); });
    return Array.from(cats).sort();
  }, [feeds, articles]);

  const filteredArticles = useMemo(() => {
    if (!articleSearchQuery && selectedCategories.size === 0) return articles;
    return articles.filter(article => {
      if (selectedCategories.size > 0 && (!article.category || !selectedCategories.has(article.category))) return false;
      if (articleSearchQuery) {
        const searchLower = articleSearchQuery.toLowerCase();
        const keywords = searchLower.split(' ').filter(k => k.trim());
        const text = (article.title + ' ' + article.description).toLowerCase();
        if (!keywords.every(k => text.includes(k))) return false;
      }
      return true;
    });
  }, [articles, articleSearchQuery, selectedCategories]);

  const fetchAndParseFeed = async (url) => {
    if (!url.includes('.')) return [];
    const targetUrl = normalizeUrl(url);
    const cached = feedCache.current[targetUrl];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

    const xmlProxyRace = async () => {
      const p1 = fetch(`${CORS_PROXY}${encodeURIComponent(targetUrl)}`).then(r => r.ok ? r.text() : Promise.reject());
      const p2 = fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`).then(r => r.ok ? r.json().then(j => j.contents) : Promise.reject());
      const p3 = fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`).then(r => r.ok ? r.text() : Promise.reject());
      const p4 = fetch(`https://thingproxy.freeboard.io/fetch/${targetUrl}`).then(r => r.ok ? r.text() : Promise.reject());
      
      const xml = await (Promise.any ? Promise.any([p1, p2, p3, p4]) : raceFirstSuccess([p1, p2, p3, p4]));
      if (!xml || (!xml.trim().startsWith('<') && !xml.includes('<rss') && !xml.includes('<feed'))) throw new Error('Invalid XML');
      const items = parseRSSXml(xml);
      if (items.length === 0) throw new Error('0 items');
      feedCache.current[targetUrl] = { timestamp: Date.now(), data: items };
      return items;
    };

    try { return await xmlProxyRace(); } catch {
      try {
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(targetUrl)}`);
        if (!res.ok) throw new Error('RSS2JSON Failed');
        const data = await res.json();
        if (data.status !== 'ok') throw new Error('RSS2JSON Status Not OK');
        const items = data.items.map(item => ({
          title: item.title,
          link: item.link,
          description: (item.description || item.content || '').replace(/<[^>]*>?/gm, '').substring(0, 300) + '...',
          pubDate: item.pubDate,
          guid: item.guid || item.link || simpleHash(item.title + item.link),
          source: data.feed.title || 'Unknown Feed',
        }));
        feedCache.current[targetUrl] = { timestamp: Date.now(), data: items };
        return items;
      } catch { return []; }
    }
  };

  const handleSearchFeeds = async (e) => {
    e.preventDefault();
    if (!feedInput) return;
    setIsDiscovering(true);
    setDiscoveredFeeds([]);
    setSearchError(null);
    setSelectedDiscoveryIds(new Set());
    const guessed = detectCategoryRuleBased(feedInput);
    if (guessed !== 'General') setAddCategory(guessed);

    try {
      const searchUrl = `${CORS_PROXY}${encodeURIComponent(`https://cloud.feedly.com/v3/search/feeds?query=${feedInput}&count=20`)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let data = null;
      try {
        const res = await fetch(searchUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) data = await res.json();
      } catch {
        const backupSearchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://cloud.feedly.com/v3/search/feeds?query=${feedInput}&count=20`)}`;
        const res = await fetch(backupSearchUrl);
        if (res.ok) { const json = await res.json(); data = JSON.parse(json.contents); }
      }

      if (data && data.results?.length > 0) {
        const formatted = data.results.map(f => ({
          title: f.title,
          url: f.feedId.replace(/^feed\//, ''),
          description: f.website || f.description || 'Found via Search',
          category: detectCategoryRuleBased(f.title + ' ' + (f.description || '')),
        }));
        setDiscoveredFeeds(formatted);
        setIsDiscovering(false);
        return;
      }
      throw new Error('No results');
    } catch {
       try {
        const items = await fetchAndParseFeed(feedInput);
        if (items.length > 0) {
          const detectedCat = detectCategoryRuleBased(feedInput);
          setDiscoveredFeeds([{ title: feedInput, url: ensureUrl(feedInput), description: 'Direct Link', category: detectedCat }]);
          setAddCategory(detectedCat);
        } else throw new Error('No items');
       } catch {
          setDiscoveredFeeds([{ url: ensureUrl(feedInput), title: feedInput, description: 'Manual Entry', category: 'General' }]);
       }
    } finally { setIsDiscovering(false); }
  };

  const toggleDiscoverySelection = (feedUrl) => {
    const newSet = new Set(selectedDiscoveryIds);
    if (newSet.has(feedUrl)) newSet.delete(feedUrl); else newSet.add(feedUrl);
    setSelectedDiscoveryIds(newSet);
  };

  const handleAddSelectedFeeds = (category = '') => {
    const feedsToAdd = discoveredFeeds.filter(f => selectedDiscoveryIds.has(f.url));
    const newFeedsList = [...feeds];
    let addedCount = 0;
    feedsToAdd.forEach(feedObj => {
      const cleanUrl = normalizeUrl(feedObj.url);
      if (!newFeedsList.some(f => normalizeUrl(f.url) === cleanUrl)) {
        newFeedsList.push({
          id: Date.now().toString() + Math.random().toString(),
          name: feedObj.title || 'New Feed',
          url: cleanUrl,
          category: category || feedObj.category || 'General',
        });
        addedCount++;
      }
    });
    if (addedCount === 0) alert('No new feeds added.');
    else {
      setFeeds(newFeedsList);
      setFeedInput('');
      setDiscoveredFeeds([]);
      setSelectedDiscoveryIds(new Set());
      setSearchError(null);
      setAddCategory('');
      setShowAddFeedModal(false);
    }
  };

  const fetchArticles = async () => {
    setLoading(true);
    setSelectedIds(new Set());
    setIsOfflineMode(false);
    if (activeView.type === 'all') aiProcessedGuids.current = new Set(); 

    let feedsToFetch = [];
    if (activeView.type === 'all') feedsToFetch = feeds;
    else if (activeView.type === 'feed') feedsToFetch = feeds.filter(f => f.id === activeView.id);
    else if (activeView.type === 'bundle') {
      const bundle = bundles.find(b => b.id === activeView.id);
      if (bundle) feedsToFetch = feeds.filter(f => bundle.feedIds.includes(f.id));
    }

    if (feedsToFetch.length === 0) { setArticles([]); setLoading(false); return; }

    // Batch Process all feeds
    const allFetchedArticles = [];
    try {
      for (let i = 0; i < feedsToFetch.length; i += MAX_CONCURRENT_REQUESTS) {
        const batch = feedsToFetch.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const promises = batch.map(async (feed) => {
          try {
            const items = await fetchAndParseFeed(feed.url);
            return items.map(item => {
              const detected = detectCategoryRuleBased(item.title + ' ' + item.description);
              const finalCategory = detected !== 'General' ? detected : (feed.category || 'General');
              return { ...item, source: item.source !== 'Unknown Feed' ? item.source : feed.name, category: finalCategory, isAiCategorized: false };
            });
          } catch (err) { console.warn(`Failed to fetch ${feed.name}`, err); return []; }
        });
        const results = await Promise.all(promises);
        results.flat().forEach(item => allFetchedArticles.push(item));
      }
      
      const uniqueMap = new Map();
      allFetchedArticles.forEach(item => { if (!uniqueMap.has(item.guid)) uniqueMap.set(item.guid, item); });
      const uniqueArticles = Array.from(uniqueMap.values());
      
      if (uniqueArticles.length > 0) localStorage.setItem('offline_articles', JSON.stringify(uniqueArticles.slice(0, 500)));
      const sorted = uniqueArticles.sort((a, b) => {
        const dateA = a.pubDate ? new Date(a.pubDate) : new Date(0);
        const dateB = b.pubDate ? new Date(b.pubDate) : new Date(0);
        return dateB - dateA;
      });
      setArticles(sorted);
    } catch (e) {
      console.error('Critical error', e);
      const offlineData = localStorage.getItem('offline_articles');
      if (offlineData) { setArticles(JSON.parse(offlineData)); setIsOfflineMode(true); }
    } finally { setLoading(false); }
  };

  const handleUpdateFeed = (e) => {
    e.preventDefault();
    if (!editingFeed) return;
    const normalizedUrl = normalizeUrl(editingFeed.url);
    const updated = { ...editingFeed, url: normalizedUrl };
    setFeeds(prev => prev.map(f => (f.id === editingFeed.id ? updated : f)));
    if (feedCache.current[normalizedUrl]) delete feedCache.current[normalizedUrl];
    setEditingFeed(null);
  };

  const handleCreateBundle = (e) => {
    e.preventDefault();
    if (!bundleName) return;
    const newBundle = { id: Date.now().toString(), name: bundleName, feedIds: Array.from(selectedFeedIdsForBundle) };
    setBundles([...bundles, newBundle]);
    setBundleName('');
    setSelectedFeedIdsForBundle(new Set());
    setShowBundleModal(false);
  };
  
  const toggleFeedInBundle = (feedId) => {
    const newSet = new Set(selectedFeedIdsForBundle);
    if (newSet.has(feedId)) newSet.delete(feedId); else newSet.add(feedId);
    setSelectedFeedIdsForBundle(newSet);
  };
  
  const deleteBundle = (id) => {
    setBundles(bundles.filter(b => b.id !== id));
    if (activeView.type === 'bundle' && activeView.id === id) setActiveView({ type: 'all', id: null });
  };
  
  const removeFeed = (id) => {
    const feed = feeds.find(f => f.id === id);
    if (feed) { const norm = normalizeUrl(feed.url); if (feedCache.current[norm]) delete feedCache.current[norm]; }
    setFeeds(feeds.filter(f => f.id !== id));
    setBundles(bundles.map(b => ({ ...b, feedIds: b.feedIds.filter(fid => fid !== id) })));
    if (activeView.type === 'feed' && activeView.id === id) setActiveView({ type: 'all', id: null });
  };

  const toggleSelection = (article) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(article.guid)) newSet.delete(article.guid); else newSet.add(article.guid);
    setSelectedIds(newSet);
  };

  const generateDigest = async () => {
    if (selectedIds.size === 0) return;
    if (!apiKey) { alert("Please enter your Gemini API Key in Settings to use AI features."); return; }
    setShowDigestModal(true); setIsGeneratingDigest(true); setDigestContent('');
    const selectedArticles = articles.filter(a => selectedIds.has(a.guid));
    const articlesText = selectedArticles.map((a, index) => `${index + 1}. Title: ${a.title}\nContent: ${a.description}`).join('\n\n');
    const prompt = `Create a "Daily Digest" summarizing key themes from these ${selectedArticles.length} articles. HTML output <h3>, <p>, <ul>. Articles:\n${articlesText}`;
    try {
      const result = await callGemini(prompt, apiKey);
      if (result) setDigestContent(sanitizeHtml(result.replace(/``````/g, '')));
      else alert("Failed to generate digest.");
    } finally { setIsGeneratingDigest(false); }
  };

  const toggleBundleExpand = (bundleId) => {
    const newSet = new Set(expandedBundles);
    if (newSet.has(bundleId)) newSet.delete(bundleId); else newSet.add(bundleId);
    setExpandedBundles(newSet);
  };
  
  const toggleCategoryFilter = (category) => {
    const newSet = new Set(selectedCategories);
    if (newSet.has(category)) newSet.delete(category); else newSet.add(category);
    setSelectedCategories(newSet);
  };

  const handleDragStart = (e, feed) => {
    setDraggedFeed(feed);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', feed.id);
  };
  
  const handleDragOver = (e, bundleId) => { e.preventDefault(); e.stopPropagation(); setDragOverBundleId(bundleId); };
  const handleDragLeave = () => { setDragOverBundleId(null); };
  
  const handleDrop = (e, bundleId) => {
    e.preventDefault(); e.stopPropagation(); setDragOverBundleId(null);
    if (!draggedFeed) return;
    setBundles(currentBundles => currentBundles.map(b => {
      if (b.id === bundleId) {
        if (b.feedIds.includes(draggedFeed.id)) return b;
        return { ...b, feedIds: [...b.feedIds, draggedFeed.id] };
      }
      return b;
    }));
    const newExpanded = new Set(expandedBundles);
    newExpanded.add(bundleId);
    setExpandedBundles(newExpanded);
    setDraggedFeed(null);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-900 font-sans text-gray-900 dark:text-gray-100 overflow-hidden">
      <BrowserView url={browserUrl} onClose={() => setBrowserUrl(null)} />
      {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:relative`}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <div className="bg-blue-600 text-white p-1 rounded"><Sparkles size={16} /></div>
            <span className="font-bold text-lg tracking-tight">RSSMindly</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-gray-500"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1">
            <button onClick={() => { setActiveView({ type: 'all', id: null }); setSidebarOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 ${activeView.type === 'all' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
              <RefreshCw size={16} /> <span className="font-medium">All Feeds</span>
            </button>
          </div>
          <div>
            <div className="px-3 flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bundles</span>
              <button onClick={() => setShowBundleModal(true)} className="text-blue-500 hover:text-blue-600"><FolderPlus size={16} /></button>
            </div>
            <div className="space-y-1">
              {bundles.map(bundle => (
                <div key={bundle.id} className={`rounded-lg transition-all duration-200 ${dragOverBundleId === bundle.id ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/50' : ''}`} onDragOver={(e) => handleDragOver(e, bundle.id)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, bundle.id)}>
                  <div className="flex items-center gap-1 group">
                    <button onClick={() => toggleBundleExpand(bundle.id)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">{expandedBundles.has(bundle.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    <button onClick={() => { setActiveView({ type: 'bundle', id: bundle.id }); setSidebarOpen(false); }} className={`flex-1 text-left py-2 pr-2 rounded-lg truncate flex items-center gap-2 ${activeView.type === 'bundle' && activeView.id === bundle.id ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}>
                      <Folder size={16} className={dragOverBundleId === bundle.id ? 'text-blue-500 animate-bounce' : 'text-gray-400'} />
                      <span className="truncate">{bundle.name}</span>
                      <span className="ml-auto text-xs text-gray-400 font-normal">{bundle.feedIds?.length || 0}</span>
                    </button>
                    <button onClick={() => deleteBundle(bundle.id)} className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                  </div>
                  {expandedBundles.has(bundle.id) && (
                    <div className="ml-4 pl-3 border-l-2 border-gray-100 dark:border-gray-700 space-y-0.5 pb-2">
                      {bundle.feedIds.length === 0 ? <div className="text-xs text-gray-400 py-1 pl-2">Empty bundle</div> : bundle.feedIds.map(fid => {
                        const f = feeds.find(feed => feed.id === fid);
                        if (!f) return null;
                        return (
                          <button key={fid} onClick={() => { setActiveView({ type: 'feed', id: fid }); setSidebarOpen(false); }} className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 truncate flex items-center gap-2">
                            <FileText size={12} /> {f.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mt-4 mb-1 px-3 text-xs font-bold text-gray-400 flex justify-between items-center cursor-pointer" onClick={() => setIsFeedsExpanded(!isFeedsExpanded)}>
              <span>FEEDS</span>
              {/* FIX: Increased gap from gap-1 to gap-12 */}
              <div className="flex items-center gap-12">
                <button onClick={(e) => { e.stopPropagation(); setShowAddFeedModal(true); }}><Plus size={14} /></button>
                {isFeedsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </div>
            {isFeedsExpanded && (
              <div className="space-y-1">
                {feeds.map(feed => (
                  <div key={feed.id} className={`group flex items-center gap-1 rounded-lg ${draggedFeed?.id === feed.id ? 'opacity-50' : ''}`} draggable="true" onDragStart={(e) => handleDragStart(e, feed)}>
                    <div className="pl-2 cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing"><GripVertical size={14} /></div>
                    <button onClick={() => { setActiveView({ type: 'feed', id: feed.id }); setSidebarOpen(false); }} className={`flex-1 text-left px-2 py-2 rounded-lg truncate ${activeView.type === 'feed' && activeView.id === feed.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}>{feed.name}</button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingFeed({ ...feed }); }} className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-blue-500 rounded" title="Edit Feed"><Pencil size={14} /></button>
                    <button onClick={() => removeFeed(feed.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-1">
          <button onClick={() => setShowHelpModal(true)} className="w-full flex items-center gap-2 px-3 py-2 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg transition-colors font-medium text-sm">
            <BookOpen size={18} className="text-purple-600 dark:text-purple-400" /> <span>User Guide & Manual</span>
          </button>
          <button onClick={() => setShowSettingsModal(true)} className="w-full flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm">
            <Settings size={18} /> <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col w-full min-w-0">
        <header className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-300"><Menu size={24} /></button>
              <h1 className="font-bold text-lg truncate flex items-center gap-2">
                {activeView.type === 'all' && 'All Articles'}
                {activeView.type === 'feed' && feeds.find(f => f.id === activeView.id)?.name}
                {activeView.type === 'bundle' && <><Folder size={20} className="text-purple-500" />{bundles.find(b => b.id === activeView.id)?.name}</>}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {isAiCategorizing && (
                <div className="hidden sm:flex items-center gap-1 text-purple-600 bg-purple-50 dark:bg-purple-900/20 px-3 py-1 rounded-full text-xs font-medium animate-pulse">
                  <Wand2 size={12} />
                  <span>AI Categorizing...</span>
                </div>
              )}
              {isOfflineMode && (
                <div className="hidden sm:flex items-center gap-1 text-orange-500 bg-orange-50 dark:bg-orange-900/20 px-3 py-1 rounded-full text-xs font-medium">
                  <WifiOff size={14} /> <span>Offline Mode</span>
                </div>
              )}
              <button
                onClick={() => setShowHelpModal(true)}
                title="User Manual & Tutorial Guide"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-300 transition-all"
              >
                <BookOpen size={13} />
                <span className="hidden sm:inline">User Guide</span>
              </button>
              <button
                onClick={handlePrewarmTrends}
                disabled={isPrewarming || articles.length === 0}
                title="Proactively pre-warm top trending story clusters into Supabase cache"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  isPrewarming
                    ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-300'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300'
                }`}
              >
                <Zap size={13} className={isPrewarming ? "animate-spin" : "fill-amber-500 text-amber-500"} />
                <span>{isPrewarming ? 'Pre-Warming...' : 'Pre-Warm'}</span>
              </button>
              <button onClick={fetchArticles} disabled={loading} className={`p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-all ${loading ? 'animate-spin' : ''}`}><RefreshCw size={20} /></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input type="text" className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-slate-700 border-0 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Search articles..." value={articleSearchQuery} onChange={(e) => setArticleSearchQuery(e.target.value)} />
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            </div>
            <div className="relative">
              <button onClick={() => setShowCategoryFilter(!showCategoryFilter)} className={`p-2 rounded-lg border ${selectedCategories.size > 0 ? 'bg-blue-50 border-blue-300 text-blue-600 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700'}`} title="Filter by Category"><Filter size={18} /></button>
              {showCategoryFilter && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowCategoryFilter(false)} />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-2 max-h-60 overflow-y-auto">
                      <div className="text-xs font-semibold text-gray-500 uppercase px-2 py-1">Categories</div>
                      {availableCategories.length === 0 && <div className="text-sm text-gray-400 px-2 py-1">No categories found.</div>}
                      {availableCategories.map(cat => (
                        <button key={cat} onClick={() => toggleCategoryFilter(cat)} className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-slate-700">
                          <span className="truncate">{cat}</span>
                          {selectedCategories.has(cat) && <CheckSquare size={16} className="text-blue-500" />}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 p-2">
                      <button onClick={() => { setSelectedCategories(new Set()); setShowCategoryFilter(false); }} className="w-full text-xs text-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 py-1 rounded">Clear Filters</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {prewarmNotice && (
          <div className="bg-amber-500 text-white text-xs font-semibold py-2 px-4 text-center animate-in slide-in-from-top duration-200 flex items-center justify-center gap-2 shadow-sm">
            <Zap size={14} className="fill-white" />
            <span>{prewarmNotice}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 relative pb-24">
          {loading && filteredArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400"><RefreshCw size={32} className="animate-spin mb-4 text-blue-500" /><p>Fetching latest news...</p></div>
          ) : !loading && filteredArticles.length === 0 ? (
            <div className="text-center py-20 px-4">
              <div className="bg-gray-100 dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Sparkles size={24} className="text-gray-400" /></div>
              <h2 className="text-xl font-bold mb-2">No articles found</h2>
              <p className="text-gray-500 max-w-sm mx-auto">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {filteredArticles.map(article => (
                <FeedItem 
                  key={article.guid} 
                  article={article} 
                  isSelected={selectedIds.has(article.guid)} 
                  onToggleSelect={toggleSelection} 
                  onOpenBrowser={setBrowserUrl} 
                  apiKey={apiKey}
                  isProMode={isProMode}
                />
              ))}
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 md:left-auto md:right-8 transform -translate-x-1/2 md:translate-x-0 z-40 animate-in slide-in-from-bottom-4 mb-[env(safe-area-inset-bottom)]">
            <button onClick={generateDigest} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full shadow-lg shadow-blue-600/30 transition-all font-medium">
              <Sparkles size={18} className="animate-pulse" /> Summarize Selected ({selectedIds.size})
            </button>
          </div>
        )}
      </main>

      <Modal isOpen={!!editingFeed} onClose={() => setEditingFeed(null)} title="Edit Feed">
        <form onSubmit={handleUpdateFeed} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Feed Name</label><input type="text" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editingFeed?.name || ''} onChange={(e) => setEditingFeed({ ...editingFeed, name: e.target.value })} required /></div>
          <div><label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Feed URL</label><input type="text" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" value={editingFeed?.url || ''} onChange={(e) => setEditingFeed({ ...editingFeed, url: e.target.value })} required /></div>
          <div><label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Category</label><div className="relative"><input type="text" list="category-options" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Tech, Finance, Health" value={editingFeed?.category || ''} onChange={(e) => setEditingFeed({ ...editingFeed, category: e.target.value })} /><datalist id="category-options">{PREDEFINED_CATEGORIES.map(cat => (<option key={cat} value={cat} />))}</datalist></div></div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition-colors">Save Changes</button>
        </form>
      </Modal>

      <Modal isOpen={showBundleModal} onClose={() => setShowBundleModal(false)} title="Create New Bundle">
        <form onSubmit={handleCreateBundle} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Bundle Name</label>
            <input
              type="text"
              placeholder="e.g. Morning Brief, Crypto, Daily AI"
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Select Feeds to Include</label>
            <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              {feeds.map(f => (
                <label key={f.id} className="flex items-center gap-2 p-1.5 hover:bg-white dark:hover:bg-slate-600 rounded cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={selectedFeedIdsForBundle.has(f.id)}
                    onChange={() => toggleFeedInBundle(f.id)}
                    className="rounded text-blue-600"
                  />
                  <span className="font-medium text-gray-800 dark:text-gray-200">{f.name}</span>
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium text-sm transition-colors">
            Create Bundle
          </button>
        </form>
      </Modal>

      <Modal isOpen={showAddFeedModal} onClose={() => { setShowAddFeedModal(false); setDiscoveredFeeds([]); setFeedInput(''); setSearchError(null); }} title="Add New RSS Feed">
        <div className="space-y-4">
          <form onSubmit={handleSearchFeeds}>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Search by Keyword or URL</label>
            <div className="relative flex gap-2">
              <div className="relative flex-1"><input type="text" className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. New York Times, TechCrunch..." value={feedInput} onChange={(e) => setFeedInput(e.target.value)} autoFocus /><Search size={16} className="absolute left-3 top-3 text-gray-400" /></div>
              <button type="submit" disabled={isDiscovering} className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg font-medium transition-colors flex items-center justify-center">{isDiscovering ? <Loader2 size={20} className="animate-spin" /> : 'Search'}</button>
            </div>
          </form>
          {searchError && <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm flex gap-2 items-start"><AlertCircle size={16} className="mt-0.5 flex-shrink-0" />{searchError}</div>}
          {discoveredFeeds.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
              <div className="flex justify-between items-end mb-2"><h4 className="text-xs font-semibold text-gray-500 uppercase">Found Feeds</h4>{selectedDiscoveryIds.size > 0 && <span className="text-xs text-blue-600 font-medium">{selectedDiscoveryIds.size} selected</span>}</div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {discoveredFeeds.map((feed, idx) => {
                  const isSelected = selectedDiscoveryIds.has(feed.url);
                  return (
                    <button key={idx} onClick={() => toggleDiscoverySelection(feed.url)} className={`w-full flex items-start gap-3 text-left p-3 rounded-lg border transition-all group ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                      <div className={`mt-1 text-gray-400 ${isSelected ? 'text-blue-600' : 'group-hover:text-gray-500'}`}>{isSelected ? <CheckSquare size={20} /> : <Square size={20} />}</div>
                      <div className="min-w-0"><div className={`font-semibold ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{feed.title}</div><div className="text-xs text-gray-500 truncate mt-0.5">{feed.url}</div>{feed.description && <div className="text-xs text-gray-400 mt-1 italic line-clamp-1">{feed.description}</div>}{feed.category && <div className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded inline-block mt-1">{feed.category}</div>}</div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                <form onSubmit={(e) => { e.preventDefault(); const formData = new FormData(e.target); handleAddSelectedFeeds(formData.get('category')); }} className="space-y-3">
                  <div><label className="block text-xs font-medium text-gray-500 mb-1">Category</label><div className="relative"><input name="category" type="text" list="category-options-add" className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Assign Category (e.g. Tech) - Optional" defaultValue={addCategory} /><datalist id="category-options-add">{PREDEFINED_CATEGORIES.map(cat => (<option key={cat} value={cat} />))}</datalist></div></div>
                  <button type="submit" disabled={selectedDiscoveryIds.size === 0} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded-lg font-medium transition-colors">Add Selected ({selectedDiscoveryIds.size})</button>
                </form>
              </div>
            </div>
          )}
          {discoveredFeeds.length === 0 && !isDiscovering && !searchError && (
            <div className="pt-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Quick Add</h4>
              <div className="flex flex-wrap gap-2">{[{ n: 'NY Times', u: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' }, { n: 'The Verge', u: 'https://www.theverge.com/rss/index.xml' }, { n: 'Wired', u: 'https://www.wired.com/feed/rss' }].map(preset => (<button key={preset.n} type="button" onClick={() => { const detected = detectCategoryRuleBased(preset.n); setFeeds(prev => [...prev, { id: Date.now().toString(), name: preset.n, url: normalizeUrl(preset.u), category: detected }]); setShowAddFeedModal(false); }} className="text-xs bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600">{preset.n}</button>))}</div>
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="App Settings">
        <div className="space-y-6">
          {/* TIER SELECTION */}
          <div className="bg-gray-100 dark:bg-slate-700 p-4 rounded-lg border border-gray-200 dark:border-gray-600">
            <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Account Tier</label>
            <div className="flex gap-2 mb-3">
              <button 
                onClick={() => setIsProMode(false)}
                className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors border ${
                  !isProMode 
                    ? 'bg-white dark:bg-slate-600 border-blue-500 text-blue-600 dark:text-blue-400 shadow-sm' 
                    : 'border-transparent text-gray-500 hover:bg-white/50'
                }`}
              >
                Free (BYOK)
              </button>
              <button 
                onClick={() => setIsProMode(true)}
                className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors border ${
                  isProMode 
                    ? 'bg-white dark:bg-slate-600 border-purple-500 text-purple-600 dark:text-purple-400 shadow-sm' 
                    : 'border-transparent text-gray-500 hover:bg-white/50'
                }`}
              >
                Pro (Managed)
              </button>
            </div>
            
            {isProMode ? (
              <div className="space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 font-bold">
                  <ShieldCheck size={14} /> 
                  <span>Enterprise Intelligence Engine Enabled</span>
                </div>
                <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-1.5 bg-white/60 dark:bg-slate-800/60 p-2.5 rounded-lg border border-purple-200/50 dark:border-purple-800/50">
                  <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300">
                    <Zap size={12} className="fill-purple-500 text-purple-500" />
                    <span>Cross-Publisher Semantic Cache</span>
                  </div>
                  <p className="text-[10px] text-gray-500 pl-4">Cosine similarity &ge;0.80 on pgvector lets different outlets covering the same story share one summary instead of a new LLM call.</p>

                  <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300 pt-1">
                    <Zap size={12} className="fill-amber-500 text-amber-500" />
                    <span>Predictive Pre-Warming</span>
                  </div>
                  <p className="text-[10px] text-gray-500 pl-4">Trend clustering runs every 15 min so stories covered by several outlets are summarised before you open them.</p>

                  <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300 pt-1">
                    <Cpu size={12} />
                    <span>Cascading Multi-Tier Summaries</span>
                  </div>
                  <p className="text-[10px] text-gray-500 pl-4">Tier 1 instant extractive preview &rarr; Tier 2 Flash bullets &rarr; Tier 3 deep dive.</p>

                  <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400 pt-1">
                    <ShieldCheck size={12} />
                    <span>Deterministic Groundedness Check</span>
                  </div>
                  <p className="text-[10px] text-gray-500 pl-4">Numbers, figures, and named entities are string-matched against the source. Reworded meaning (e.g. negation) is not detected.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 animate-in fade-in">
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-bold">
                  <Key size={14} /> 
                  <span>Bring Your Own Key</span>
                </div>
                <div className="relative">
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Enter your Gemini API Key" />
                  <Key size={16} className="absolute left-3 top-2.5 text-gray-400" />
                </div>
                {/* FIX: Added Detailed API Key Guide */}
                <div className="flex flex-col gap-2 mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-md border border-blue-100 dark:border-blue-800">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-medium text-xs">
                    <Info size={14} />
                    <span>How to get a Key:</span>
                  </div>
                  <ol className="list-decimal list-inside text-[10px] text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold">Google AI Studio</a>.</li>
                    <li>Click <strong>"Create API Key"</strong>.</li>
                    <li>Select "Create key in new project".</li>
                    <li>Copy the key and paste it above.</li>
                  </ol>
                  <a href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline mt-1 block">
                    Read official documentation &rarr;
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Appearance</label>
            <div className="grid grid-cols-3 gap-2">{[{ id: 'light', icon: Sun, label: 'Light' }, { id: 'dark', icon: Moon, label: 'Dark' }, { id: 'system', icon: Monitor, label: 'System' }].map(opt => (<button key={opt.id} onClick={() => setTheme(opt.id)} className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${theme === opt.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700'}`}><opt.icon size={20} className="mb-1" /><span className="text-xs font-medium">{opt.label}</span></button>))}</div>
          </div>
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700 text-center text-xs text-gray-400">RSSMindly AI v2.0 (Freemium)</div>
        </div>
      </Modal>

      {/* USER MANUAL & INTERACTIVE GUIDE MODAL */}
      <Modal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} title="RSSMindly — User Guide & Interactive Manual">
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* TAB NAVIGATION */}
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-slate-700/70 rounded-xl overflow-x-auto text-xs">
            {[
              { id: 'quickstart', label: '🚀 Quickstart' },
              { id: 'summaries', label: '⚡ Smart Summaries' },
              { id: 'semantic', label: '🧠 0-Token Cache' },
              { id: 'byok', label: '🔑 BYOK & Privacy' },
              { id: 'mobile', label: '📱 Mobile (A2HS)' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setHelpTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all ${
                  helpTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 shadow-sm border border-gray-200/60 dark:border-gray-700'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: QUICKSTART */}
          {helpTab === 'quickstart' && (
            <div className="space-y-3.5 text-xs text-gray-700 dark:text-gray-300">
              <div className="bg-purple-50 dark:bg-purple-950/40 p-3 rounded-xl border border-purple-200 dark:border-purple-800">
                <h4 className="font-bold text-sm text-purple-900 dark:text-purple-200 flex items-center gap-1.5 mb-1">
                  <span>Welcome to RSSMindly</span>
                </h4>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                  RSSMindly is an intelligent reader that eliminates news clutter using multi-tier AI summarization and cross-publisher deduplication.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-start gap-2.5 p-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200/70 dark:border-gray-600">
                  <div className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold px-2 py-0.5 rounded text-[11px]">1</div>
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Adding Feeds:</span> Click <span className="font-mono bg-gray-200 dark:bg-slate-600 px-1 py-0.5 rounded text-[10px]">+</span> next to Feeds in the sidebar. Enter any website domain or RSS URL, or pick from popular presets (NYT, Verge, Wired).
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200/70 dark:border-gray-600">
                  <div className="bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 font-bold px-2 py-0.5 rounded text-[11px]">2</div>
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Folder Bundles:</span> Group related sources (e.g., Tech, Finance, Science) using <FolderPlus size={12} className="inline mx-0.5 text-purple-500" /> to filter your feeds with one click.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200/70 dark:border-gray-600">
                  <div className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold px-2 py-0.5 rounded text-[11px]">3</div>
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Distraction-Free Reading:</span> Click any article headline to open it in a clean, ad-free reader overlay with dark mode and zero cookie popups.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SMART SUMMARIES */}
          {helpTab === 'summaries' && (
            <div className="space-y-3.5 text-xs text-gray-700 dark:text-gray-300">
              <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl border border-gray-200 dark:border-gray-600 space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white text-xs">
                  <Cpu size={14} className="text-purple-500" /> Cascading 3-Tier Summaries Explained
                </div>
                <p className="text-gray-500 dark:text-gray-400">RSSMindly uses a tiered architecture to maximize speed and eliminate waiting:</p>
              </div>

              <div className="space-y-2">
                <div className="p-2.5 rounded-lg border border-purple-200/80 dark:border-purple-800/80 bg-purple-50/60 dark:bg-purple-950/30">
                  <div className="font-semibold text-purple-900 dark:text-purple-200 flex items-center justify-between mb-1">
                    <span>⚡ Tier 1: Instant Micro-Summary</span>
                    <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400">&lt; 1ms • 0 Tokens</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">Runs locally in pure client JavaScript. Immediately extracts the primary factual lead sentence while any deeper request loads.</p>
                </div>

                <div className="p-2.5 rounded-lg border border-blue-200/80 dark:border-blue-800/80 bg-blue-50/60 dark:bg-blue-950/30">
                  <div className="font-semibold text-blue-900 dark:text-blue-200 flex items-center justify-between mb-1">
                    <span>⚡ Tier 2: 3-Bullet Flash Takeaways</span>
                    <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">Gemini 1.5 Flash</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">Structured high-density takeaways covering key catalysts, confirmed numbers, and market ramifications.</p>
                </div>

                <div className="p-2.5 rounded-lg border border-amber-200/80 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/30">
                  <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center justify-between mb-1">
                    <span>📖 Tier 3: Long Intelligence Brief (On-Demand)</span>
                    <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">4-Part Brief</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">Click <b>"📖 View Full Brief"</b> on any article to generate an extensive executive dossier with confirmed figures, quotes, and strategic outlook.</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 0-TOKEN SEMANTIC CACHE */}
          {helpTab === 'semantic' && (
            <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 space-y-1.5">
                <h4 className="font-bold text-sm text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                  <Database size={14} className="text-purple-600 dark:text-purple-400" /> Cross-Publisher Semantic Deduplication
                </h4>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                  When 10 news outlets report on the exact same press release or news event, RSSMindly avoids making 10 expensive duplicate LLM calls.
                </p>
              </div>

              <div className="space-y-2 bg-gray-50 dark:bg-slate-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="font-semibold text-gray-900 dark:text-white">How it operates:</div>
                <ul className="list-disc pl-4 space-y-1 text-gray-600 dark:text-gray-300">
                  <li>Headlines are embedded as 768-dimensional vectors using Google's <code className="bg-gray-200 dark:bg-slate-800 px-1 rounded">gemini-embedding-001</code>.</li>
                  <li>Stored in a Supabase <b>pgvector HNSW index</b> with a &ge;0.80 cosine similarity threshold (calibrated for this embedding model).</li>
                  <li>Competing wire stories reuse an existing summary: <b>no generation call</b>, just one embedding lookup, with the same deterministic source check.</li>
                  <li>Click the <b>⚡ Pre-Warm</b> button anytime to proactively cluster and cache viral multi-feed stories.</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 4: BYOK & PRIVACY */}
          {helpTab === 'byok' && (
            <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
              <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl border border-gray-200 dark:border-gray-600 space-y-2">
                <h4 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-1.5">
                  <Key size={14} className="text-blue-500" /> Bring Your Own Key (BYOK)
                </h4>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                  RSSMindly is completely free to use. You can plug in your own free Gemini API key with zero mandatory subscriptions.
                </p>
              </div>

              <div className="space-y-2">
                <div className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-800 space-y-1">
                  <span className="font-semibold text-gray-900 dark:text-white">1. Get a Free Key:</span>
                  <p className="text-gray-500 dark:text-gray-400">Visit <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline font-medium">aistudio.google.com/app/apikey</a> and create a key with 1 click.</p>
                </div>
                <div className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-800 space-y-1">
                  <span className="font-semibold text-gray-900 dark:text-white">2. Paste in Settings:</span>
                  <p className="text-gray-500 dark:text-gray-400">Open <b>Settings</b> in the sidebar, paste your key, and click Save.</p>
                </div>
                <div className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-800 space-y-1">
                  <span className="font-semibold text-gray-900 dark:text-white">3. Complete Local Privacy:</span>
                  <p className="text-gray-500 dark:text-gray-400">Keys and feed lists reside strictly inside your browser's private <code className="bg-gray-100 dark:bg-slate-900 px-1 rounded">localStorage</code>.</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: MOBILE & PWA */}
          {helpTab === 'mobile' && (
            <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 space-y-1">
                <h4 className="font-bold text-sm text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                  <Download size={14} className="text-purple-600 dark:text-purple-400" /> Install as a Native App (PWA)
                </h4>
                <p className="text-gray-600 dark:text-gray-300">No App Store or Play Store download required. Install directly to your device home screen.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-gray-600 space-y-1.5">
                  <div className="font-bold text-gray-900 dark:text-white">🍏 iPhone & iPad (Safari)</div>
                  <ol className="list-decimal pl-4 space-y-1 text-gray-600 dark:text-gray-300">
                    <li>Tap the <b>Share</b> icon at bottom.</li>
                    <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
                    <li>Tap <b>Add</b> in top right.</li>
                  </ol>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-gray-600 space-y-1.5">
                  <div className="font-bold text-gray-900 dark:text-white">🤖 Android (Chrome)</div>
                  <ol className="list-decimal pl-4 space-y-1 text-gray-600 dark:text-gray-300">
                    <li>Tap the <b>three dots (⋮)</b> in top right.</li>
                    <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
                    <li>Confirm installation.</li>
                  </ol>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 italic text-center">Runs fullscreen with native gesture support, dark mode, and offline caching.</p>
            </div>
          )}

          <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs">
            <span className="text-gray-400">Documentation: <code className="text-gray-500 dark:text-gray-300">docs/USER_MANUAL.md</code></span>
            <button
              onClick={() => setShowHelpModal(false)}
              className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDigestModal} onClose={() => setShowDigestModal(false)} title="Your AI Daily Digest">
        {isGeneratingDigest ? (
          <div className="flex flex-col items-center justify-center py-12"><Sparkles size={48} className="text-blue-500 animate-spin mb-4" /><p className="text-lg font-medium animate-pulse">Analyzing articles...</p><p className="text-sm text-gray-500 mt-2">Connecting dots between your selected stories.</p></div>
        ) : (
          <div className="prose prose-blue dark:prose-invert max-w-none">
            <div className="space-y-4 [&>h3]:text-lg [&>h3]:font-bold [&>h3]:text-blue-700 [&>h3]:dark:text-blue-400 [&>h3]:mt-6 [&>h3:first-child]:mt-0 [&>ul]:list-disc [&>ul]:pl-5 [&>p]:leading-relaxed [&>li]:mb-1" dangerouslySetInnerHTML={{ __html: digestContent }} />
            <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button onClick={() => { const tempDiv = document.createElement('div'); tempDiv.innerHTML = digestContent; navigator.clipboard.writeText(tempDiv.textContent || tempDiv.innerText || ''); }} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Copy Text to Clipboard</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}