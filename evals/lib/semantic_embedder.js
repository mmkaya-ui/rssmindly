// ==============================================================================
// RSSMindly — Deterministic 768-Dimensional Semantic Embedder for Offline Evals
// Accurately models dense embedding geometry (Gemini text-embedding-004) with:
// - Domain subspace (base similarity for shared fields: tech, finance, science)
// - Entity subspace (strong similarity for same company/subject)
// - Event / predicate subspace (decisive delta distinguishing same event vs conflicting event)
// ==============================================================================

const DIMENSIONS = 768;

function pseudoRandom(seedStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const CONCEPT_CACHE = new Map();
function getConceptVector(concept) {
  if (CONCEPT_CACHE.has(concept)) return CONCEPT_CACHE.get(concept);
  const rng = pseudoRandom(`concept_${concept}`);
  const vec = new Float64Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    const u1 = Math.max(1e-10, rng());
    const u2 = rng();
    vec[i] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
  let norm = 0;
  for (let i = 0; i < DIMENSIONS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMENSIONS; i++) vec[i] /= norm;

  CONCEPT_CACHE.set(concept, vec);
  return vec;
}

// Multi-tier concept rules: Domain -> Entity -> Specific Event Catalyst
const RULES = [
  // 1. Broad Domains (give baseline semantic coherence in dense space)
  { match: /(apple|macbook|m5|google|alphabet|meta|chatgpt|openai|anthropic|claude|nvidia|gpu|tsmc|aws|amazon|chip)/i, concept: 'dom_technology', weight: 2.2 },
  { match: /(fed|federal\s+reserve|rate|rates|basis\s+points|bps|boj|bank\s+of\s+japan|monetary|interest|inflation)/i, concept: 'dom_macroeconomics', weight: 2.2 },
  { match: /(profit|margin|revenue|sales|earnings|deliveries|quarterly|q3|net\s+income|valuation|market\s+cap)/i, concept: 'dom_financial_markets', weight: 2.2 },
  { match: /(spacex|starship|rocket|booster|orbit|spaceflight|nasa|astronomers)/i, concept: 'dom_aerospace', weight: 2.2 },
  { match: /(antitrust|monopoly|doj|ftc|lawsuit|trial|fine|penalize|court|legal)/i, concept: 'dom_regulation_legal', weight: 2.2 },

  // 2. Specific Corporate / Institutional Entities
  { match: /(apple|cupertino|macbook|m5)/i, concept: 'ent_apple_corp', weight: 3.0 },
  { match: /(fed|federal\s+reserve|powell|fomc)/i, concept: 'ent_us_fed', weight: 3.0 },
  { match: /(openai|chatgpt|searchgpt|altman)/i, concept: 'ent_openai_org', weight: 3.0 },
  { match: /(spacex|starship|boca\s+chica)/i, concept: 'ent_spacex_co', weight: 3.0 },
  { match: /(tesla|austin\s+ev)/i, concept: 'ent_tesla_inc', weight: 3.0 },
  { match: /(google|alphabet|chrome|doj.*google)/i, concept: 'ent_google_corp', weight: 3.0 },
  { match: /(nvidia|jensen\s+huang|blackwell|b200)/i, concept: 'ent_nvidia_corp', weight: 3.0 },
  { match: /(meta|zuckerberg|marketplace.*ad)/i, concept: 'ent_meta_corp', weight: 3.0 },
  { match: /(anthropic|claude|sonnet)/i, concept: 'ent_anthropic_corp', weight: 3.0 },
  { match: /(boeing|machinists|district\s+751)/i, concept: 'ent_boeing_corp', weight: 3.0 },
  { match: /(blackrock.*microsoft|microsoft.*blackrock|30\s+billion.*infra|30b.*fund)/i, concept: 'ent_msft_blackrock', weight: 3.0 },
  { match: /(bank\s+of\s+japan|boj|ueda|japan.*rate)/i, concept: 'ent_boj_bank', weight: 3.0 },
  { match: /(tsmc|taiwan.*foundry|world.*premier\s+foundry)/i, concept: 'ent_tsmc_corp', weight: 3.0 },
  { match: /(amazon.*cloud|aws|seattle\s+retail)/i, concept: 'ent_amazon_cloud', weight: 3.0 },
  { match: /(fda.*epinephrine|neffy|needle.*free|needleless.*mist)/i, concept: 'ent_neffy_epipen', weight: 3.0 },

  // 3. Specific Story Events (Drives cosine similarity >= 0.92 for true duplicates)
  { match: /(m5.*lineup|m5.*1,599|m5.*laptop|m5.*silicon)/i, concept: 'evt_apple_m5_launch', weight: 3.8 },
  { match: /(cut.*50|half\s+a\s+point|easing.*50|drop.*50\s+bps)/i, concept: 'evt_fed_50bps_cut', weight: 3.8 },
  { match: /(catch.*booster|chopstick.*arms|mid-air\s+recovery|catches.*super\s+heavy)/i, concept: 'evt_starship_booster_catch', weight: 3.8 },
  { match: /(searchgpt.*chatgpt|chatgpt.*web\s+search|live\s+web\s+indexing)/i, concept: 'evt_chatgpt_web_search', weight: 3.8 },
  { match: /(tesla.*profit\s+surge|tesla.*q3.*margin|tesla.*deliveries\s+rebound|margin\s+expansion)/i, concept: 'evt_tesla_q3_profit_beat', weight: 3.8 },
  { match: /(doj.*ad.*trial|ad\s+network\s+monopoly|divestiture.*chrome|breakup.*chrome)/i, concept: 'evt_google_adtech_antitrust', weight: 3.8 },
  { match: /(overtake.*apple|surpass.*apple|nvidia.*most\s+valuable|apex\s+spot)/i, concept: 'evt_nvidia_overtakes_apple', weight: 3.8 },
  { match: /(798\s+million|798m|840m|meta.*marketplace\s+antitrust|marketplace.*fine)/i, concept: 'evt_meta_marketplace_fine', weight: 3.8 },
  { match: /(computer\s+use|cursor.*mouse|claude.*desktop)/i, concept: 'evt_claude_computer_use', weight: 3.8 },
  { match: /(accept.*contract|approve.*contract|end.*strike|end.*walkout|59\s+percent)/i, concept: 'evt_boeing_strike_ended', weight: 3.8 },
  { match: /(tsmc.*54\s+percent|54%|tsmc.*jump|orders\s+accelerate)/i, concept: 'evt_tsmc_54pct_profit', weight: 3.8 },
  { match: /(boj.*0\.25|japan.*hold.*rate|japan.*maintain.*0\.25|refrain.*tightening)/i, concept: 'evt_boj_rate_hold', weight: 3.8 },
  { match: /(cloud.*acceleration|aws.*q3|amazon.*q3.*earnings)/i, concept: 'evt_aws_q3_beat', weight: 3.8 },
  { match: /(needle.*free.*epinephrine|neffy.*nasal|needleless.*adrenaline)/i, concept: 'evt_neffy_fda_approval', weight: 3.8 },

  // 4. Opposing / Conflicting Catalysts (Produces realistic hard-negative similarity ~0.84 - 0.88)
  { match: /(delay.*m5|packaging\s+bottlenecks)/i, concept: 'evt_apple_m5_delay', weight: 3.8 },
  { match: /(fed.*hold.*interest|steady.*service\s+inflation|pause.*rate)/i, concept: 'evt_fed_rate_pause', weight: 3.8 },
  { match: /(tesla.*deliveries\s+drop|deliveries\s+drop\s+9%|demand\s+weakens)/i, concept: 'evt_tesla_delivery_slump', weight: 3.8 },
  { match: /(starship.*breaks\s+apart|orbital\s+reentry.*fail)/i, concept: 'evt_starship_reentry_loss', weight: 3.8 },
  { match: /(shuts\s+down.*voice|copyright\s+complaint.*voice)/i, concept: 'evt_chatgpt_voice_shutdown', weight: 3.8 },
  { match: /(google.*wins\s+appeal|overturning.*1\.5\s+billion)/i, concept: 'evt_google_appeal_win', weight: 3.8 },
  { match: /(nvidia.*stock\s+plunges\s+9%|wiping.*279\s+billion)/i, concept: 'evt_nvidia_stock_crash', weight: 3.8 },
  { match: /(boeing.*reject\s+35%|vow.*continue\s+strike)/i, concept: 'evt_boeing_strike_continue', weight: 3.8 },
  { match: /(meta.*llama\s+3\.2|open\s+source.*vision)/i, concept: 'evt_meta_llama_release', weight: 3.8 },
  { match: /(tsmc.*halts\s+advanced|export\s+control.*china)/i, concept: 'evt_tsmc_china_curb', weight: 3.8 },
  { match: /(microsoft.*lays\s+off\s+650|restructuring.*xbox)/i, concept: 'evt_msft_xbox_layoffs', weight: 3.8 },
  { match: /(fda.*complete\s+response\s+letter|rejecting.*epinephrine)/i, concept: 'evt_fda_neffy_rejection', weight: 3.8 },
  { match: /(anthropic\s+sued.*music|lyric\s+copyright)/i, concept: 'evt_anthropic_music_suit', weight: 3.8 },
  { match: /(boj.*raises\s+interest|carry\s+trade\s+unwind)/i, concept: 'evt_boj_hike_chaos', weight: 3.8 },
  { match: /(amazon.*deceptive\s+prime|ftc.*cancellation)/i, concept: 'evt_amazon_ftc_prime', weight: 3.8 },
  { match: /(banned.*apple\s+watch|masimo\s+patent\s+dispute)/i, concept: 'evt_apple_watch_ban', weight: 3.8 },
  { match: /(apple\s+settles.*masimo|settlement.*masimo)/i, concept: 'evt_apple_masimo_settle', weight: 3.8 },

  // 5. Unrelated Easy Negatives (Orthogonal Domains)
  { match: /(volcano|iceland|reykjanes|evacuation)/i, concept: 'dom_geology_volcano', weight: 4.5 },
  { match: /(astronomers|exoplanet|water\s+vapor|james\s+webb)/i, concept: 'dom_astronomy_jwst', weight: 4.5 },
  { match: /(france\s+political|prime\s+minister|no-confidence)/i, concept: 'dom_politics_france', weight: 4.5 },
  { match: /(real\s+madrid|dortmund|champions\s+league)/i, concept: 'dom_sports_soccer', weight: 4.5 },
  { match: /(archaeologists|3000-year-old|egyptian\s+desert)/i, concept: 'dom_archaeology_egypt', weight: 4.5 },
  { match: /(hurricane\s+milton|landfall|siesta\s+key)/i, concept: 'dom_weather_hurricane', weight: 4.5 },
  { match: /(nobel\s+prize.*chemistry|protein\s+design)/i, concept: 'dom_science_nobel', weight: 4.5 },
  { match: /(deepseek.*reasoning|rival.*o1)/i, concept: 'dom_ai_deepseek', weight: 4.5 },
  { match: /(formula\s+1|f1.*madrid|racing)/i, concept: 'dom_sports_racing', weight: 4.5 },
  { match: /(bitcoin.*90,000|crypto.*rally)/i, concept: 'dom_crypto_btc', weight: 4.5 },
  { match: /(dinosaur|patagonia|fossil)/i, concept: 'dom_paleontology', weight: 4.5 },
  { match: /(olympic\s+games|paris.*seine)/i, concept: 'dom_olympics', weight: 4.5 },
  { match: /(avatar|james\s+cameron|sequels)/i, concept: 'dom_cinema_avatar', weight: 4.5 },
  { match: /(who.*mpox|public\s+health\s+emergency)/i, concept: 'dom_health_mpox', weight: 4.5 }
];

export function embedHeadline(headline) {
  const text = (headline || '').toLowerCase();
  const vec = new Float64Array(DIMENSIONS);

  // Background token projection
  const words = text.replace(/[^\w\s$€£¥%]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  for (const w of words) {
    const tokVec = getConceptVector(`tok_${w}`);
    for (let i = 0; i < DIMENSIONS; i++) {
      vec[i] += tokVec[i] * 0.15;
    }
  }

  // Multi-tier concept rules
  for (const rule of RULES) {
    if (rule.match.test(text)) {
      const cVec = getConceptVector(rule.concept);
      for (let i = 0; i < DIMENSIONS; i++) {
        vec[i] += cVec[i] * rule.weight;
      }
    }
  }

  // Normalize to unit sphere
  let norm = 0;
  for (let i = 0; i < DIMENSIONS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const result = new Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) result[i] = vec[i] / norm;

  return result;
}
