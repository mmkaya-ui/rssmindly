// ==============================================================================
// RSSMindly — Groundedness Evaluation Benchmark (30 Test Cases)
// Measures the empirical detection rate of evaluateGroundedness against injected errors.
// Analyzes True Positives, True Negatives, False Positives, and False Negatives.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { evaluateGroundedness } from '../api/lib/groundedness.js';

export const GROUNDEDNESS_CASES = [
  // ----------------------------------------------------------------------------
  // CLEAN / GROUNDED SUMMARIES (Expected: isGrounded === true)
  // ----------------------------------------------------------------------------
  {
    id: 'g01',
    title: 'Apple Unveils New M5 MacBook Pro Lineup',
    source: 'Apple on Tuesday announced its next-generation M5 MacBook Pro lineup, featuring up to 3.5x faster neural processing for local AI models. The new machines start at $1,599 and will begin shipping next Friday across 30 countries.',
    summary: '<ul><li>Apple launched the M5 MacBook Pro featuring up to 3.5x faster neural processing.</li><li>Base pricing starts at $1,599 with availability in 30 countries next Friday.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Directly supported facts, price $1,599, multiplier 3.5x, 30 countries'
  },
  {
    id: 'g02',
    title: 'Federal Reserve Cuts Benchmark Rate by 50 Basis Points',
    source: 'The Federal Reserve lowered its key lending rate by 50 basis points to a range of 4.75% to 5.00%, marking the first policy easing in four years.',
    summary: '<ul><li>The Federal Reserve reduced interest rates by 50 basis points.</li><li>New target range is established between 4.75% and 5.00%.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Accurate percentage rates and 50 basis points cut'
  },
  {
    id: 'g03',
    title: 'TSMC Reports Record Quarterly Earnings',
    source: 'Taiwan Semiconductor Manufacturing Company (TSMC) reported a 54% surge in net profit to NT$325.3 billion, driven by booming demand for advanced AI accelerators from Nvidia and Apple.',
    summary: '<ul><li>TSMC posted a 54% jump in quarterly net profit.</li><li>Growth was driven by customer orders from Nvidia and Apple.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Supported corporate entities and 54% profit increase'
  },
  {
    id: 'g04',
    title: 'SpaceX Catches Super Heavy Booster at Starbase',
    source: 'SpaceX successfully guided the 232-foot-tall Super Heavy booster back to its launch pad in Texas, where the mechanical arms of the Mechazilla tower caught it mid-air.',
    summary: '<ul><li>SpaceX achieved a mid-air catch of the Super Heavy booster in Texas.</li><li>The vehicle was secured by the mechanical arms of the launch tower.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Supported aerospace entities and geographical location'
  },
  {
    id: 'g05',
    title: 'Meta Fined by European Commission',
    source: 'The European Union hit Meta with a fine of 798 million euros ($840 million) on Thursday for tying its classified ads service, Facebook Marketplace, to Facebook.',
    summary: '<ul><li>The European Commission penalized Meta 798 million euros for antitrust breaches.</li><li>The action centers on the integration of Facebook Marketplace with Facebook.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'European Commission fine of 798 million euros'
  },
  {
    id: 'g06',
    title: 'Boeing Machinists Approve Contract Ending Strike',
    source: 'Boeing machinists represented by District 751 voted 59% in favor of a new four-year contract that includes a 38% wage hike, concluding a 53-day work stoppage in Washington state.',
    summary: '<ul><li>Boeing machinists approved a new agreement with a 59% majority.</li><li>The settlement provides a 38% wage increase and concludes a 53-day strike.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Multiple verified numbers: 59%, 38%, 53 days'
  },
  {
    id: 'g07',
    title: 'Microsoft and BlackRock Launch AI Fund',
    source: 'Microsoft, BlackRock, and Global Infrastructure Partners announced the creation of a $30 billion fund to build data centers and energy infrastructure supporting artificial intelligence.',
    summary: '<ul><li>Microsoft and BlackRock created a $30 billion fund for AI infrastructure.</li><li>Capital will be deployed to develop data centers and energy facilities.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Correct investment figure $30 billion and named sponsors'
  },
  {
    id: 'g08',
    title: 'Bank of Japan Leaves Benchmark Rate Unchanged',
    source: 'The Bank of Japan maintained its short-term policy interest rate at 0.25% at the conclusion of its October monetary policy meeting in Tokyo.',
    summary: '<ul><li>The Bank of Japan kept its benchmark lending rate at 0.25%.</li><li>Governor and committee members signaled no immediate shift in Tokyo.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Rate 0.25% accurately stated'
  },
  {
    id: 'g09',
    title: 'FDA Approves Neffy Nasal Spray',
    source: 'ARS Pharmaceuticals won FDA approval for Neffy, the first epinephrine nasal spray for emergency treatment of severe allergic reactions in adults and children weighing at least 30 kg.',
    summary: '<ul><li>The FDA approved Neffy as the first epinephrine nasal spray for severe allergic reactions.</li><li>Treatment is indicated for patients weighing at least 30 kg.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Medical treatment name and 30 kg weight threshold'
  },
  {
    id: 'g10',
    title: 'Anthropic Unveils Computer Use Capability',
    source: 'Anthropic introduced an upgraded Claude 3.5 Sonnet model capable of interpreting computer screens, moving mouse cursors, and typing into forms.',
    summary: '<ul><li>Anthropic released an upgraded Claude 3.5 Sonnet model.</li><li>The AI can directly interact with computer desktop screens and input text.</li></ul>',
    expected_grounded: true,
    category: 'clean_grounded',
    notes: 'Clean descriptive summary without numbers'
  },

  // ----------------------------------------------------------------------------
  // INJECTED HALLUCINATED NUMBERS / METRICS (Expected: isGrounded === false)
  // ----------------------------------------------------------------------------
  {
    id: 'g11',
    title: 'Apple Unveils New M5 MacBook Pro Lineup',
    source: 'Apple on Tuesday announced its next-generation M5 MacBook Pro lineup starting at $1,599 with availability in 30 countries.',
    summary: '<ul><li>Apple launched the M5 MacBook Pro starting at a premium price of $2,999.</li><li>Available across 30 countries.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake price $2,999 instead of $1,599'
  },
  {
    id: 'g12',
    title: 'Apple Unveils New M5 MacBook Pro Lineup',
    source: 'Apple on Tuesday announced its next-generation M5 MacBook Pro lineup starting at $1,599 with availability in 30 countries.',
    summary: '<ul><li>Apple launched the M5 MacBook Pro starting at $1,599.</li><li>The product is shipping immediately to 150 countries.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake country count 150 instead of 30'
  },
  {
    id: 'g13',
    title: 'Apple Unveils New M5 MacBook Pro Lineup',
    source: 'Apple on Tuesday announced its next-generation M5 MacBook Pro lineup, featuring up to 3.5x faster neural processing for local AI models.',
    summary: '<ul><li>The M5 MacBook Pro delivers an astonishing 10x faster neural processing capability.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake multiplier 10x instead of 3.5x'
  },
  {
    id: 'g14',
    title: 'TSMC Reports Record Quarterly Earnings',
    source: 'TSMC reported a 54% surge in net profit driven by booming demand for advanced AI accelerators.',
    summary: '<ul><li>TSMC posted an unprecedented 85% surge in quarterly net profit.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake profit percentage 85% instead of 54%'
  },
  {
    id: 'g15',
    title: 'Microsoft and BlackRock Launch AI Fund',
    source: 'Microsoft and BlackRock announced a $30 billion fund to build data centers and energy infrastructure supporting AI.',
    summary: '<ul><li>Microsoft and BlackRock launched a massive $300 billion investment vehicle for AI.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake figure $300 billion instead of $30 billion'
  },
  {
    id: 'g16',
    title: 'Boeing Machinists Approve Contract Ending Strike',
    source: 'Boeing machinists voted in favor of a new contract, concluding a 53-day work stoppage in Washington state.',
    summary: '<ul><li>Boeing machinists concluded a grueling 100-day work stoppage after ratifying the agreement.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake strike duration 100-day instead of 53-day'
  },
  {
    id: 'g17',
    title: 'Microsoft Restructures Gaming Division',
    source: 'Microsoft announced plans to lay off 650 employees from its Xbox gaming business as part of ongoing reorganization.',
    summary: '<ul><li>Microsoft laid off 6,500 workers across its gaming division in an unexpected move.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake headcount 6,500 instead of 650'
  },
  {
    id: 'g18',
    title: 'Bank of Japan Leaves Benchmark Rate Unchanged',
    source: 'The Bank of Japan maintained its short-term policy interest rate at 0.25% following its October meeting.',
    summary: '<ul><li>The Bank of Japan maintained the policy interest rate at 5.25% in Tokyo.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_number',
    notes: 'Injected fake interest rate 5.25% instead of 0.25%'
  },

  // ----------------------------------------------------------------------------
  // INJECTED HALLUCINATED ENTITIES / PROPER NOUNS (Expected: isGrounded === false)
  // ----------------------------------------------------------------------------
  {
    id: 'g19',
    title: 'Google Antitrust Lawsuit Developments',
    source: 'The Department of Justice argued in federal court that Google maintains an illegal monopoly in ad tech infrastructure.',
    summary: '<ul><li>Federal prosecutors led by the DOJ accused Satya Nadella of orchestrating anticompetitive ad bundling.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Injected Microsoft CEO Satya Nadella into Google case'
  },
  {
    id: 'g20',
    title: 'TSMC Expands Foundry Operations',
    source: 'TSMC confirmed capital expenditure of $30 billion to build advanced packaging fabrication facilities in Taiwan.',
    summary: '<ul><li>Intel Foundry finalized a $30 billion investment to expand advanced packaging production.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Replaced TSMC with competitor Intel Foundry'
  },
  {
    id: 'g21',
    title: 'Commercial Aircraft Manufacturing Orders',
    source: 'Boeing secured a contract for 50 widebody aircraft from a major carrier during the Farnborough air show.',
    summary: '<ul><li>Airbus secured a landmark order for 50 widebody passenger jets during the exhibition.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Replaced Boeing with rival Airbus'
  },
  {
    id: 'g22',
    title: 'Healthcare AI Research Collaboration',
    source: 'Stanford Medicine researchers demonstrated an algorithmic model for detecting early-stage pneumonia from chest X-rays.',
    summary: '<ul><li>DeepMind Analytics Corp formed an exclusive commercial agreement with Stanford clinicians.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Invented non-existent commercial entity DeepMind Analytics Corp'
  },
  {
    id: 'g23',
    title: 'Global Central Banking Policy Statements',
    source: 'The Federal Reserve indicated that further monetary adjustments would depend strictly on incoming employment metrics.',
    summary: '<ul><li>The European Central Bank signaled that interest rate moves will depend on US payroll figures.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Replaced Federal Reserve with European Central Bank'
  },
  {
    id: 'g24',
    title: 'Smartwatch Patent Dispute Updates',
    source: 'Apple faced legal restrictions in the United States concerning blood oxygen sensor technology licensed from Masimo.',
    summary: '<ul><li>Apple reached a preliminary licensing framework with Qualcomm over pulse oximetry technology.</li></ul>',
    expected_grounded: false,
    category: 'injected_wrong_entity',
    notes: 'Replaced medical tech firm Masimo with semiconductor firm Qualcomm'
  },

  // ----------------------------------------------------------------------------
  // EDGE CASES: FORMATTING VARIATIONS & CHALLENGING DETECTIONS
  // ----------------------------------------------------------------------------
  {
    id: 'g25',
    title: 'Consumer Hardware Pricing Announcement',
    source: 'The new hardware device will be available in retail stores for 1599 dollars starting this November.',
    summary: '<ul><li>Retail pricing was confirmed at $1,599 with launch scheduled for November.</li></ul>',
    expected_grounded: true,
    category: 'formatting_edge_case',
    notes: 'Numeric comma formatting: source has "1599 dollars" while summary has "$1,599"'
  },
  {
    id: 'g26',
    title: 'Renewable Power Share Reaches High',
    source: 'Wind and solar generated 42 percent of European electricity generation last month according to energy data.',
    summary: '<ul><li>Clean generation from wind and solar achieved 42% of total European electricity output.</li></ul>',
    expected_grounded: true,
    category: 'formatting_edge_case',
    notes: 'Percentage representation: source has "42 percent" while summary has "42%"'
  },
  {
    id: 'g27',
    title: 'Regulatory Penalty In Europe',
    source: 'Authorities announced a financial sanction of 500 million euros against the online platform.',
    summary: '<ul><li>The platform was ordered to pay €500 million in regulatory penalties.</li></ul>',
    expected_grounded: true,
    category: 'formatting_edge_case',
    notes: 'Currency symbol: source has "500 million euros", summary has "€500 million"'
  },
  {
    id: 'g28',
    title: 'Urban Transit System Expansion',
    source: 'City council officials voted to fund 2 new transit routes connecting northern suburbs to downtown.',
    summary: '<ul><li>Transit authority received authorization to construct 8 new commuter rail routes.</li></ul>',
    expected_grounded: false,
    category: 'single_digit_hallucination',
    notes: 'Single digit hallucination: source has "2", summary invents "8"'
  },
  {
    id: 'g29',
    title: 'Executive Appointments in Technology',
    source: 'Board member John Higgins welcomed the incoming vice president, while chief architect Michael Smith offered remarks.',
    summary: '<ul><li>The board formally appointed John Smith as the new executive vice president.</li></ul>',
    expected_grounded: false,
    category: 'split_name_coincidence',
    notes: 'Entity recombination: "John" from John Higgins + "Smith" from Michael Smith = fake entity "John Smith"'
  },
  {
    id: 'g30',
    title: 'Smartphone Lineup Availability Details',
    source: 'Pre-orders for the flagship handset opened earlier this morning through major carriers.',
    summary: '<ul><li>Pricing information was not disclosed during the keynote broadcast.</li></ul>',
    expected_grounded: true,
    category: 'sentence_starter_stopword',
    notes: 'Stopword at sentence start: "Pricing" must not be treated as a hallucinated corporate entity'
  }
];

export function runGroundednessEval() {
  console.log('===============================================================');
  console.log(`🛡️ EVALUATING DETERMINISTIC GROUNDEDNESS (${GROUNDEDNESS_CASES.length} TEST CASES)`);
  console.log('===============================================================\n');

  let tp = 0; // Correctly flagged hallucination
  let tn = 0; // Correctly passed grounded summary
  let fp = 0; // Grounded summary falsely flagged as hallucination
  let fn = 0; // Hallucinated summary falsely passed as grounded

  const falsePositives = [];
  const falseNegatives = [];

  const results = GROUNDEDNESS_CASES.map(c => {
    const report = evaluateGroundedness(c.summary, c.source, c.title);
    const predictedGrounded = report.isGrounded;
    const actualGrounded = c.expected_grounded;

    let outcome = '';
    if (!predictedGrounded && !actualGrounded) {
      tp++;
      outcome = 'TP (Correctly caught hallucination)';
    } else if (predictedGrounded && actualGrounded) {
      tn++;
      outcome = 'TN (Correctly passed grounded)';
    } else if (!predictedGrounded && actualGrounded) {
      fp++;
      outcome = 'FP (False alarm on grounded text)';
      falsePositives.push({ caseId: c.id, summary: c.summary, violations: report.violations, notes: c.notes });
    } else if (predictedGrounded && !actualGrounded) {
      fn++;
      outcome = 'FN (Missed hallucination)';
      falseNegatives.push({ caseId: c.id, summary: c.summary, notes: c.notes });
    }

    return {
      id: c.id,
      category: c.category,
      expected: actualGrounded ? 'GROUNDED' : 'HALLUCINATED',
      predicted: predictedGrounded ? 'GROUNDED' : 'HALLUCINATED',
      score: report.score,
      violationsCount: report.violations.length,
      outcome
    };
  });

  const total = GROUNDEDNESS_CASES.length;
  const accuracy = Number((((tp + tn) / total) * 100).toFixed(1));
  const precision = (tp + fp) === 0 ? 100 : Number(((tp / (tp + fp)) * 100).toFixed(1));
  const recall = (tp + fn) === 0 ? 100 : Number(((tp / (tp + fn)) * 100).toFixed(1));
  const f1 = (precision + recall) === 0 ? 0 : Number(((2 * precision * recall) / (precision + recall)).toFixed(1));

  console.log('| Case ID | Category | Expected | Predicted | Violations | Outcome |');
  console.log('|---------|----------|----------|-----------|------------|---------|');
  results.forEach(r => {
    console.log(`| ${r.id.padEnd(7)} | ${r.category.padEnd(26)} | ${r.expected.padEnd(12)} | ${r.predicted.padEnd(11)} | ${String(r.violationsCount).padStart(10)} | ${r.outcome} |`);
  });

  console.log('\n--- Groundedness Evaluation Summary ---');
  console.log(`- Total Cases: ${total}`);
  console.log(`- Accuracy:  ${accuracy}% (${tp + tn}/${total})`);
  console.log(`- Precision: ${precision}% (Catch quality: how many flagged items were real hallucinations)`);
  console.log(`- Recall:    ${recall}% (Coverage: how many injected hallucinations were caught)`);
  console.log(`- F1 Score:  ${f1}%\n`);

  if (falsePositives.length > 0) {
    console.log('⚠️ FALSE POSITIVES (Grounded summaries falsely flagged):');
    falsePositives.forEach(fpCase => {
      console.log(`  [${fpCase.caseId}] ${fpCase.notes}`);
      console.log(`    Violations flagged:`, fpCase.violations);
    });
    console.log();
  } else {
    console.log('✅ Zero False Positives recorded!\n');
  }

  if (falseNegatives.length > 0) {
    console.log('❌ FALSE NEGATIVES (Hallucinations that slipped through):');
    falseNegatives.forEach(fnCase => {
      console.log(`  [${fnCase.caseId}] ${fnCase.notes}`);
    });
    console.log();
  } else {
    console.log('✅ Zero False Negatives recorded!\n');
  }

  // Save results to evals/data/groundedness_results.json
  const outPath = path.resolve('evals/data/groundedness_results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    total, tp, tn, fp, fn, accuracy, precision, recall, f1,
    falsePositives, falseNegatives, results
  }, null, 2), 'utf8');

  return { accuracy, precision, recall, f1, tp, tn, fp, fn, falsePositives, falseNegatives };
}

if (process.argv[1]?.endsWith('eval_groundedness.js')) {
  runGroundednessEval();
}
