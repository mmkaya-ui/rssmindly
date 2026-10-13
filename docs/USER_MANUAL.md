# RSSMindly User Manual & Complete Guide

Welcome to **RSSMindly**, the AI-powered intelligent feed reader with cross-publisher semantic caching, instant multi-tier summaries, and native mobile PWA support.

This manual explains how every feature works, how to get started, and how to get the most out of your reading experience.

---

## Table of Contents
1. [Quickstart (30-Second Setup)](#1-quickstart-30-second-setup)
2. [Managing Your Feeds & Bundles](#2-managing-your-feeds--bundles)
3. [Understanding AI Summarization Tiers](#3-understanding-ai-summarization-tiers)
   - [Tier 1: Instant Micro-Summary (0ms, 0 Tokens)](#tier-1-instant-micro-summary-0ms-0-tokens)
   - [Tier 2: Structured 3-Bullet Takeaways](#tier-2-structured-3-bullet-takeaways)
   - [Tier 3: On-Demand Long-Form Intelligence Brief](#tier-3-on-demand-long-form-intelligence-brief)
4. [Zero-Token Semantic Caching (How It Saves You Time & Money)](#4-zero-token-semantic-caching)
5. [Deterministic Zero-Hallucination Verification](#5-deterministic-zero-hallucination-verification)
6. [Daily Briefing & Topic Digest Generation](#6-daily-briefing--topic-digest-generation)
7. [BYOK (Bring Your Own Key) Setup](#7-byok-bring-your-own-key-setup)
8. [Mobile Installation (PWA / Add to Home Screen)](#8-mobile-installation-pwa--add-to-home-screen)
9. [Distraction-Free Reading Mode (smry.ai)](#9-distraction-free-reading-mode-smryai)
10. [FAQ & Troubleshooting](#10-faq--troubleshooting)

---

## 1. Quickstart (30-Second Setup)

When you first open RSSMindly, sample feeds are already loaded (TechCrunch, BBC, Wired, etc.) so you can explore immediately:

1. **Browse Articles:** Scroll through your unified timeline or select a specific feed or folder bundle from the left sidebar.
2. **Instant Micro-Summary:** Click **⚡ Summarize** on any story. An instant extractive preview appears in `< 1ms` with **0 tokens** while the AI analyzes the article.
3. **Expand Full Brief:** Toggle between **⚡ 3 Bullets** and **📖 View Full Brief** to read a long-form strategic breakdown.
4. **Clean Reading View:** Click any article title to open it in a clean, ad-free reader overlay.

---

## 2. Managing Your Feeds & Bundles

### Adding a New Feed
1. Open the left sidebar and click the **`+`** icon next to **Feeds**.
2. Enter any RSS feed URL, or type the website name/domain (e.g. `theverge.com` or `https://news.ycombinator.com/rss`).
3. RSSMindly automatically detects available RSS/Atom endpoints.
4. Quick preset buttons (**NY Times**, **The Verge**, **Wired**) let you subscribe with a single click.

### Organizing with Topic Bundles
1. In the sidebar, click the **Folder Plus (`+`)** icon next to **Bundles**.
2. Give your bundle a name (e.g., *AI & Tech*, *Finance*, *World News*).
3. Select which feeds belong to this bundle and save.
4. Clicking a bundle filters your timeline strictly to that group of publishers.

### Auto-Categorization
RSSMindly includes an intelligent categorizer that tags incoming feeds into categories (Tech, News, Business, Science, Design, Gaming) based on metadata and rule-based heuristics.

---

## 3. Understanding AI Summarization Tiers

RSSMindly uses a **cascading 3-tier architecture** designed to give you instant feedback while minimizing API latency and costs.

```
Article Ingestion ───► Tier 1: Local Extractive (< 1ms, 0 tokens)
                              │
                              ▼
                     Semantic Cache Check (pgvector)
                      ├── Match > 0.92? ──► Instant Cache Hit (45ms, 0 tokens)
                      └── Cache Miss ──────► Tier 2: Gemini 1.5 Flash (3 Bullets)
                                                   │
                                                   ▼ (On User Request)
                                             Tier 3: Long Intelligence Brief
```

### Tier 1: Instant Micro-Summary (0ms, 0 Tokens)
* **What it is:** A client-side deterministic sentence extractor.
* **How it works:** Analyzes headline salience, lead paragraphs, and sentence boundaries to extract the core factual sentence.
* **Cost & Speed:** **0.1ms execution, 0 tokens ($0.00 cost)**. Displayed immediately as a purple badge so you never wait staring at a blank loading spinner.

### Tier 2: Structured 3-Bullet Takeaways
* **What it is:** High-density, skimmable bullet points powered by Gemini 1.5 Flash.
* **Format:**
  - Lead catalyst & what happened.
  - Key figures, dollar amounts, or technical specifics.
  - Wider impact or immediate next steps.

### Tier 3: On-Demand Long-Form Intelligence Brief
* **What it is:** A comprehensive, multi-paragraph strategic briefing for complex stories.
* **How to trigger:** On any summarized article, click the **`📖 Read Longer Brief`** / **`📖 View Full Brief`** button in the **Summary Depth** bar.
* **Structure:**
  1. **Executive Overview & Key Developments:** Narrative context of what occurred.
  2. **Detailed Background & Key Statements:** Direct quotes and historical precedents.
  3. **Key Metrics & Confirmed Figures:** Itemized table/list of all numbers and verified statistics.
  4. **Strategic Industry & Future Outlook:** Winners, losers, and what to watch next.
* **Persistence:** Once loaded, the long brief is saved to cache for instant 0ms, 0-token recall across sessions.

---

## 4. Zero-Token Semantic Caching

### The Problem in Traditional Readers
During major news events (e.g. an Apple product release or an OpenAI announcement), 15 different news outlets publish virtually identical stories. In normal AI readers, summarizing each article triggers 15 separate API requests and costs 15x tokens.

### How RSSMindly Solves It
1. Every headline and lead story is converted into a 768-dimensional mathematical vector using Gemini embeddings.
2. When **Reuters** publishes *"Apple unveils M5 MacBook Pro starting at $1,599"*, it is summarized and saved into Supabase pgvector.
3. When **CNBC** or **The Verge** publishes *"Apple announces new M5 laptops starting at $1,599"*, RSSMindly calculates the cosine similarity.
4. Because the similarity exceeds **92%**, RSSMindly detects the duplicate story and immediately returns the cached summary.
5. **Result:** **0 tokens spent, latency drops from 2,500ms down to 45ms.**

---

## 5. Deterministic Zero-Hallucination Verification

Every summary generated by RSSMindly is run through a strict verification filter before being cached:
* **Metric Extraction:** Gathers all prices (`$1,599`), percentages (`25%`), multipliers (`3.5x`), and dates.
* **Source Cross-Check:** Verifies each metric exists verbatim in the source article.
* **Rejection & Fallback:** If an ungrounded metric is detected, the summary is rejected and regenerated at `temperature: 0.0`.
* **Badge:** Verified articles display a **"Grounded • 0 Hallucinations"** badge.

---

## 6. Daily Briefing & Topic Digest Generation

Want an executive roundup across all your feeds at once?

1. Click the **Sparkles (`✨ Generate AI Digest`)** button in the top navigation bar.
2. Select your scope:
   - **All Feeds** or a specific **Folder Bundle**.
   - Time window: **Last 24 Hours**, **Last 3 Days**, or **All Unread**.
3. RSSMindly clusters top news cycles and produces a unified, cross-feed daily briefing.
4. You can copy the digest with one click or save it for later.

---

## 7. BYOK (Bring Your Own Key) Setup

RSSMindly is 100% free and open, with zero mandatory subscription fees. You can use your own Google Gemini API key:

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey) and generate a free API key.
2. In RSSMindly, click **Settings** (gear icon) in the bottom-left sidebar.
3. Paste your key into the **Google Gemini API Key** field and click **Save**.
4. **Security & Privacy:**
   - Your key is saved strictly in your local browser storage (`localStorage`).
   - If the backend server is unreachable, RSSMindly automatically switches to direct client-side requests using your key.

---

## 8. Mobile Installation (PWA / Add to Home Screen)

You do not need an app store download to use RSSMindly on mobile:

### On iPhone & iPad (Safari)
1. Open the RSSMindly website in Safari.
2. Tap the **Share** button (box with an arrow pointing up) at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The app will now launch with full-screen, notch-aware standalone display without browser URL bars.

### On Android (Chrome)
1. Open RSSMindly in Chrome.
2. Tap the **three-dot menu (⋮)** in the top right.
3. Tap **Install app** or **Add to Home screen**.
4. The app icon appears in your app drawer and functions like a native application.

---

## 9. Distraction-Free Reading Mode (smry.ai)

When you click on any article in your feed:
* RSSMindly opens a clean overlay powered by `smry.ai`.
* Bypasses heavy clutter, paywall banners, tracking cookies, and popup ads.
* Lets you read long-form journalism with dark-mode typography and distraction-free styling.

---

## 10. FAQ & Troubleshooting

### Why is an article summary marked as "⚡ Micro-Summary"?
This is the instant Tier 1 extractive preview. If your backend is offline or you haven't entered an API key, this micro-summary ensures you still get instant value without errors.

### How do I clear the local cache?
Go to **Settings → Cache Management** and click **Clear Cached Summaries**. This clears local cache entries without deleting your subscribed feeds.

### Can I export or import my feeds?
Yes! In **Settings**, you can import or export your feed list via standard OPML or JSON format to migrate between devices seamlessly.

### Where is my data hosted?
All feed subscriptions, reading states, and API keys reside locally in your browser storage. Cached summaries in shared mode are stored in your configured Supabase pgvector database.
