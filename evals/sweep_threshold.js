// ==============================================================================
// RSSMindly — Cosine Similarity Threshold Sweep (0.80 - 0.98)
// Evaluates Precision, Recall, and F1 on evals/data/pairs.jsonl
// Generates tabular results and renders a standalone PNG chart.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { cosineSimilarity } from '../api/lib/embedding.js';
import { embedHeadline } from './lib/semantic_embedder.js';
import { SimpleCanvas } from './lib/png.js';

const PAIR_EMBEDDINGS_PATH = path.resolve('evals/data/pair_embeddings.json');
const PRODUCTION_THRESHOLD = 0.92;

/**
 * Picks the embedder. Real cached text-embedding-004 vectors are used when
 * evals/data/pair_embeddings.json exists (created by evals/embed_pairs.js).
 * Otherwise falls back to the hand-written rule embedder, which was authored
 * while looking at this same dataset and is NOT evidence about the real model.
 */
function loadEmbedder(pairs) {
  if (fs.existsSync(PAIR_EMBEDDINGS_PATH)) {
    const fixture = JSON.parse(fs.readFileSync(PAIR_EMBEDDINGS_PATH, 'utf8'));
    const missing = pairs.flatMap(p => [p.headline_a, p.headline_b]).filter(h => !fixture.vectors[h]);
    if (missing.length === 0) {
      return {
        kind: 'real',
        label: `${fixture.model} (cached ${fixture.generated_at.slice(0, 10)}, ${fixture.input})`,
        embed: (h) => fixture.vectors[h]
      };
    }
    console.warn(`⚠️ pair_embeddings.json is missing ${missing.length} headlines; re-run evals/embed_pairs.js. Falling back to simulated embedder.`);
  }
  return {
    kind: 'simulated',
    label: 'SIMULATED rule-based embedder (evals/lib/semantic_embedder.js) — tuned on this dataset, not representative of text-embedding-004',
    embed: embedHeadline
  };
}

export function runThresholdSweep() {
  const jsonlPath = path.resolve('evals/data/pairs.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`Dataset not found at ${jsonlPath}. Run evals/data_builder.js first.`);
  }

  const rawLines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean);
  const pairs = rawLines.map(line => JSON.parse(line));
  const embedder = loadEmbedder(pairs);

  console.log('===============================================================');
  console.log(`📊 EVALUATING COSINE THRESHOLD SWEEP (${pairs.length} PAIRS)`);
  console.log('===============================================================');
  console.log(`Embedder: ${embedder.label}\n`);

  // Precompute embeddings and similarities for all pairs
  const scoredPairs = pairs.map(p => {
    const vecA = embedder.embed(p.headline_a);
    const vecB = embedder.embed(p.headline_b);
    const sim = Number(cosineSimilarity(vecA, vecB).toFixed(4));
    return { ...p, similarity: sim };
  });

  // Thresholds to sweep: 0.80 to 0.98 in increments of 0.01
  const thresholds = [];
  for (let t = 80; t <= 98; t += 1) {
    thresholds.push(Number((t / 100).toFixed(2)));
  }

  const sweepResults = [];
  let bestF1 = -1;
  let bestThreshold = null;

  for (const t of thresholds) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;

    for (const p of scoredPairs) {
      const predictedDuplicate = p.similarity >= t;
      const actualDuplicate = p.is_duplicate;

      if (predictedDuplicate && actualDuplicate) tp++;
      else if (predictedDuplicate && !actualDuplicate) fp++;
      else if (!predictedDuplicate && !actualDuplicate) tn++;
      else if (!predictedDuplicate && actualDuplicate) fn++;
    }

    const precision = (tp + fp) === 0 ? 1.0 : tp / (tp + fp);
    const recall = (tp + fn) === 0 ? 1.0 : tp / (tp + fn);
    const f1 = (precision + recall) === 0 ? 0.0 : (2 * precision * recall) / (precision + recall);

    const record = {
      threshold: t,
      tp, fp, tn, fn,
      precision: Number((precision * 100).toFixed(1)),
      recall: Number((recall * 100).toFixed(1)),
      f1: Number((f1 * 100).toFixed(1))
    };

    sweepResults.push(record);

    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = t;
    }
  }

  // Print Formatted Table
  console.log('| Threshold | Precision | Recall | F1 Score | TP | FP | TN | FN | Notes |');
  console.log('|-----------|-----------|--------|----------|----|----|----|----|-------|');

  for (const r of sweepResults) {
    let note = '';
    if (r.threshold === bestThreshold) note = 'Peak F1';
    if (r.threshold === PRODUCTION_THRESHOLD) note = note ? `${note}, production` : 'production';
    console.log(
      `|   ${r.threshold.toFixed(2)}    |   ${r.precision.toFixed(1)}%  |  ${r.recall.toFixed(1)}% |   ${r.f1.toFixed(1)}%  | ${String(r.tp).padStart(2)} | ${String(r.fp).padStart(2)} | ${String(r.tn).padStart(2)} | ${String(r.fn).padStart(2)} | ${note.padEnd(17)} |`
    );
  }

  const defaultRecord = sweepResults.find(r => r.threshold === PRODUCTION_THRESHOLD);
  const bestRecord = sweepResults.find(r => r.threshold === bestThreshold);

  // Separation: how far apart are the two classes in cosine space?
  const dupSims = scoredPairs.filter(p => p.is_duplicate).map(p => p.similarity);
  const nonDupSims = scoredPairs.filter(p => !p.is_duplicate).map(p => p.similarity);
  const lowestDuplicate = scoredPairs.filter(p => p.is_duplicate).sort((a, b) => a.similarity - b.similarity)[0];
  const highestNonDuplicate = scoredPairs.filter(p => !p.is_duplicate).sort((a, b) => b.similarity - a.similarity)[0];
  const separation = {
    minDuplicate: Math.min(...dupSims),
    maxNonDuplicate: Math.max(...nonDupSims),
    lowestDuplicate,
    highestNonDuplicate
  };

  // Is 0.92 dominated? (another threshold with >= precision AND > recall)
  const dominatedBy = sweepResults.filter(r =>
    r.threshold !== PRODUCTION_THRESHOLD &&
    r.precision >= defaultRecord.precision &&
    r.recall > defaultRecord.recall
  );
  const bestDominator = dominatedBy.sort((a, b) => b.recall - a.recall || b.threshold - a.threshold)[0] || null;

  const lines = [];
  lines.push(`Peak F1 is ${bestRecord.f1}% at ${bestThreshold}. At ${PRODUCTION_THRESHOLD}: precision ${defaultRecord.precision}%, recall ${defaultRecord.recall}%, F1 ${defaultRecord.f1}%.`);
  if (bestDominator) {
    lines.push(`${PRODUCTION_THRESHOLD} is dominated on this dataset: ${bestDominator.threshold} has the same or better precision (${bestDominator.precision}%) and higher recall (${bestDominator.recall}%). The data does not support 0.92 as the best choice.`);
  } else {
    lines.push(`No threshold in the sweep beats ${PRODUCTION_THRESHOLD} on both precision and recall.`);
  }
  if (separation.minDuplicate > separation.maxNonDuplicate) {
    lines.push(`Classes are fully separable: every duplicate scores above ${separation.maxNonDuplicate.toFixed(4)} and every non-duplicate scores at or below it. Any threshold in (${separation.maxNonDuplicate.toFixed(4)}, ${separation.minDuplicate.toFixed(4)}] is perfect on this set.`);
  } else {
    lines.push(`Classes overlap: lowest-scoring duplicate ${separation.minDuplicate.toFixed(4)} ([${lowestDuplicate.id}]) < highest-scoring non-duplicate ${separation.maxNonDuplicate.toFixed(4)} ([${highestNonDuplicate.id}]). No threshold is perfect.`);
  }
  if (embedder.kind === 'simulated') {
    lines.push('These similarities come from a simulated embedder written against this same dataset. Treat the whole sweep as a harness smoke test, not as evidence for or against 0.92.');
  }
  const honestAssessment = lines.join(' ');

  console.log('\n--- Sweep Analysis ---');
  for (const l of lines) console.log(`- ${l}`);
  console.log('');

  // Render PNG Line Chart
  renderChartPng(sweepResults, bestThreshold, embedder.kind);

  return {
    sweepResults,
    bestThreshold,
    bestF1: bestRecord.f1,
    defaultThreshold: PRODUCTION_THRESHOLD,
    defaultF1: defaultRecord.f1,
    defaultRecord,
    dominatedBy: bestDominator,
    separation,
    embedderKind: embedder.kind,
    embedderLabel: embedder.label,
    assessmentLines: lines,
    honestAssessment,
    scoredPairs
  };
}

function renderChartPng(results, _bestT, embedderKind = 'simulated') {
  const width = 720;
  const height = 400;
  const canvas = new SimpleCanvas(width, height, [248, 250, 252, 255]); // slate-50 background

  // Margins
  const padLeft = 65;
  const padRight = 35;
  const padTop = 50;
  const padBottom = 60;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Title (bitmap font has no J/K/Q/Z or parentheses, so wording is constrained)
  canvas.drawText('RSSMINDLY COSINE SIMILARITY THRESHOLD SWEEP', padLeft, 16, [15, 23, 42, 255], 2);
  const subtitle = embedderKind === 'real'
    ? 'EMBEDDER: TEXT-EMBEDDING-004 CACHED VECTORS - HEADLINES ONLY'
    : 'EMBEDDER: SIMULATED RULES - NOT A REAL MODEL - HARNESS TEST ONLY';
  canvas.drawText(subtitle, padLeft, 34, embedderKind === 'real' ? [100, 116, 139, 255] : [225, 29, 72, 255], 1);

  // Axes lines
  canvas.drawLine(padLeft, padTop + chartH, padLeft + chartW, padTop + chartH, [148, 163, 184, 255], 2); // X-axis
  canvas.drawLine(padLeft, padTop, padLeft, padTop + chartH, [148, 163, 184, 255], 2); // Y-axis

  // Y-axis gridlines & labels (0% to 100%)
  for (let pct = 0; pct <= 100; pct += 20) {
    const y = padTop + chartH - (pct / 100) * chartH;
    canvas.drawLine(padLeft, y, padLeft + chartW, y, [226, 232, 240, 255], 1);
    canvas.drawText(`${pct}%`, padLeft - 35, y - 3, [100, 116, 139, 255], 1);
  }

  // X-axis coordinate mapper
  const minT = results[0].threshold;
  const maxT = results[results.length - 1].threshold;
  const getX = (t) => padLeft + ((t - minT) / (maxT - minT)) * chartW;
  const getY = (val) => padTop + chartH - (val / 100) * chartH;

  // X-axis tick labels
  for (let i = 0; i < results.length; i += 2) {
    const r = results[i];
    const x = getX(r.threshold);
    canvas.drawLine(x, padTop + chartH, x, padTop + chartH + 5, [148, 163, 184, 255], 1);
    canvas.drawText(r.threshold.toFixed(2), x - 12, padTop + chartH + 10, [100, 116, 139, 255], 1);
  }

  // Draw 0.92 marker line
  const x92 = getX(0.92);
  for (let y = padTop; y < padTop + chartH; y += 4) {
    canvas.setPixel(Math.round(x92), y, 225, 29, 72, 255); // rose-600 dotted
  }
  canvas.drawText('0.92 DEFAULT', x92 - 32, padTop - 12, [225, 29, 72, 255], 1);

  // Plot Precision (Blue: 37, 99, 235)
  for (let i = 0; i < results.length - 1; i++) {
    const x0 = getX(results[i].threshold);
    const y0 = getY(results[i].precision);
    const x1 = getX(results[i + 1].threshold);
    const y1 = getY(results[i + 1].precision);
    canvas.drawLine(x0, y0, x1, y1, [37, 99, 235, 255], 2);
  }

  // Plot Recall (Green: 22, 163, 74)
  for (let i = 0; i < results.length - 1; i++) {
    const x0 = getX(results[i].threshold);
    const y0 = getY(results[i].recall);
    const x1 = getX(results[i + 1].threshold);
    const y1 = getY(results[i + 1].recall);
    canvas.drawLine(x0, y0, x1, y1, [22, 163, 74, 255], 2);
  }

  // Plot F1 (Purple: 147, 51, 234)
  for (let i = 0; i < results.length - 1; i++) {
    const x0 = getX(results[i].threshold);
    const y0 = getY(results[i].f1);
    const x1 = getX(results[i + 1].threshold);
    const y1 = getY(results[i + 1].f1);
    canvas.drawLine(x0, y0, x1, y1, [147, 51, 234, 255], 3);
  }

  // Legend at bottom
  const legY = height - 22;
  canvas.drawRect(padLeft, legY, 14, 8, [37, 99, 235, 255]);
  canvas.drawText('PRECISION', padLeft + 18, legY + 1, [37, 99, 235, 255], 1);

  canvas.drawRect(padLeft + 110, legY, 14, 8, [22, 163, 74, 255]);
  canvas.drawText('RECALL', padLeft + 128, legY + 1, [22, 163, 74, 255], 1);

  canvas.drawRect(padLeft + 200, legY, 14, 8, [147, 51, 234, 255]);
  canvas.drawText('F1 SCORE', padLeft + 218, legY + 1, [147, 51, 234, 255], 1);

  canvas.drawRect(padLeft + 300, legY, 14, 8, [225, 29, 72, 255]);
  canvas.drawText('0.92 THRESHOLD', padLeft + 318, legY + 1, [225, 29, 72, 255], 1);

  const outPath = path.resolve('evals/threshold_sweep.png');
  fs.writeFileSync(outPath, canvas.toBuffer());
  console.log(`📈 Chart saved to: ${outPath}`);
}

if (process.argv[1]?.endsWith('sweep_threshold.js')) {
  runThresholdSweep();
}
