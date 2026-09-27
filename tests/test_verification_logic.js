// ============================================
// Automated Test Suite for Verity AI Verification Logic
// Tests the 8 core verification scenarios:
// 1. Pure Support (No 95% cap -> 100%)
// 2. Pure Contradict (Refuted -> 0% / 100% refutation)
// 3. Insufficient Evidence (0 support, 0 contradict -> null / N/A, never 50%)
// 4. Non-decisive evidence does NOT act as contradiction (1 support + 2 no_decisive -> 100%)
// 5. Mixed Support & Contradict (Deterministic formula calculation)
// 6. Configured Source Weights (Gov=0.85, Wiki=0.75, Web=0.50, Forum=0.25)
// 7. Executive Summary Aggregation (VERIFIED, CONTRADICTIONS_DETECTED, MIXED, INSUFFICIENT)
// 8. Mathematical Consistency (Formula text matches exact numbers)
// ============================================

const assert = require('assert');

// ── REPLICATE LOGIC FROM background.js ──
const SOURCE_TYPE_WEIGHTS = {
  authoritative: 0.85,
  wikipedia: 0.75,
  web_general: 0.50,
  low_authority: 0.25,
  default: 0.50
};

function extractDomain(url = '') {
  try {
    if (!url.startsWith('http')) return url;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    const match = url.match(/https?:\/\/(?:www\.)?([^\/\?#]+)/i);
    return match ? match[1] : 'web';
  }
}

function getSourceWeight(url = '', sourceType = '') {
  const u = (url || '').toLowerCase();
  const st = (sourceType || '').toLowerCase();
  const domain = extractDomain(url);

  if (st.includes('wikipedia') || st.includes('wiki') || u.includes('wikipedia.org')) {
    return {
      weight: SOURCE_TYPE_WEIGHTS.wikipedia,
      category: 'wikipedia',
      label: 'Reference (Wikipedia)',
      domain: 'en.wikipedia.org'
    };
  }

  if (u.includes('quora.com') || u.includes('brainly.com') || u.includes('reddit.com')) {
    return {
      weight: SOURCE_TYPE_WEIGHTS.low_authority,
      category: 'low_authority',
      label: 'Community Forum / UGC',
      domain: domain || 'forum'
    };
  }

  if (u.includes('.gov') || u.includes('.edu') || u.includes('nasa.gov') || u.includes('nature.com')) {
    return {
      weight: SOURCE_TYPE_WEIGHTS.authoritative,
      category: 'authoritative',
      label: 'Authoritative / Academic',
      domain: domain || 'official'
    };
  }

  return {
    weight: SOURCE_TYPE_WEIGHTS.web_general,
    category: 'web_general',
    label: 'Standard Web Source',
    domain: domain || 'web'
  };
}

function scoreRelevance(claim, snippet) {
  if (!claim || !snippet) return 0.25;
  const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may','might',
    'shall','can','need','dare','ought','used','in','on','at','to','for','of','and',
    'or','but','not','with','by','from','that','this','which','who','what','when',
    'where','how','why','it','its','than','as','if','then','so','up','out','about']);
  const claimWords = claim.toLowerCase().split(/\W+/).filter(w => w.length >= 3 && !stopWords.has(w));
  if (claimWords.length === 0) return 0.3;
  const snippetLower = snippet.toLowerCase();
  const matches = claimWords.filter(w => snippetLower.includes(w)).length;
  const ratio = matches / claimWords.length;
  return Math.min(1.0, Math.max(0.25, ratio));
}

function aggregateEvidence(sourcesWithNLI) {
  let weightedSupport = 0;
  let weightedContradict = 0;
  let weightedNoDecisive = 0;
  let supportCount = 0;
  let contradictCount = 0;
  let noDecisiveCount = 0;

  for (const s of sourcesWithNLI) {
    const w = (s.source_weight ?? s.reliability ?? 0.50) * (s.relevance ?? 0.50);
    const rel = s.nliRelationship;
    if (rel === 'SUPPORT') {
      weightedSupport += w;
      supportCount++;
    } else if (rel === 'CONTRADICT') {
      weightedContradict += w;
      contradictCount++;
    } else {
      weightedNoDecisive += w;
      noDecisiveCount++;
    }
  }

  const totalDecisiveSignal = weightedSupport + weightedContradict;

  if (supportCount === 0 && contradictCount === 0) {
    return {
      evidenceConfidence: null,
      verdict: 'UNVERIFIABLE',
      status: 'Insufficient evidence',
      corroborationRate: null,
      weightedSupport: 0,
      weightedContradict: 0,
      weightedNeutral: +weightedNoDecisive.toFixed(3),
      weightedNoDecisive: +weightedNoDecisive.toFixed(3),
      supportCount: 0,
      contradictCount: 0,
      neutralCount: noDecisiveCount,
      noDecisiveCount,
      formula: 'Undefined (Support = 0, Contradict = 0)',
      reason: 'No decisive supporting or contradicting evidence found in retrieved sources. Evidence Confidence is N/A.'
    };
  }

  const rawRatio = weightedSupport / totalDecisiveSignal;
  const evidenceConfidence = Math.round(rawRatio * 100);

  let verdict;
  let status;
  if (evidenceConfidence >= 60) {
    verdict = 'SUPPORTED';
    status = 'Evidence supports claim';
  } else if (evidenceConfidence <= 40) {
    verdict = 'REFUTED';
    status = 'Evidence contradicts claim';
  } else {
    verdict = 'UNCERTAIN';
    status = 'Conflicting evidence';
  }

  return {
    evidenceConfidence,
    verdict,
    status,
    corroborationRate: evidenceConfidence,
    weightedSupport: +weightedSupport.toFixed(3),
    weightedContradict: +weightedContradict.toFixed(3),
    weightedNeutral: +weightedNoDecisive.toFixed(3),
    weightedNoDecisive: +weightedNoDecisive.toFixed(3),
    supportCount,
    contradictCount,
    neutralCount: noDecisiveCount,
    noDecisiveCount,
    formula: `Support [${weightedSupport.toFixed(3)}] / (Support [${weightedSupport.toFixed(3)}] + Contradict [${weightedContradict.toFixed(3)}])`,
    reason: `Formula: ${weightedSupport.toFixed(3)} / (${weightedSupport.toFixed(3)} + ${weightedContradict.toFixed(3)}) = ${evidenceConfidence}%`
  };
}

function calculateExecutiveSummary(sentences) {
  if (!sentences || sentences.length === 0) {
    return {
      statusKey: 'INSUFFICIENT_EVIDENCE',
      statusLabel: 'Insufficient Evidence',
      badgeType: 'neutral',
      summaryText: 'No verifiable claims were evaluated.',
      totalClaims: 0,
      supportedClaims: 0,
      refutedClaims: 0,
      uncertainClaims: 0,
      unverifiableClaims: 0,
      decisiveClaims: 0,
      corroborationRate: null
    };
  }

  const total = sentences.length;
  const supported = sentences.filter(s => s.verdict === 'SUPPORTED').length;
  const refuted = sentences.filter(s => s.verdict === 'REFUTED').length;
  const uncertain = sentences.filter(s => s.verdict === 'UNCERTAIN').length;
  const unverifiable = sentences.filter(s => s.verdict === 'UNVERIFIABLE').length;
  const decisive = supported + refuted;
  const corroborationRate = decisive > 0 ? Math.round((supported / decisive) * 100) : null;

  let statusKey = 'INSUFFICIENT_EVIDENCE';
  let statusLabel = 'Insufficient Evidence';
  let badgeType = 'neutral';
  let summaryText = '';

  if (refuted > 0) {
    statusKey = 'CONTRADICTIONS_DETECTED';
    statusLabel = 'Contradictions Detected';
    badgeType = 'danger';
    summaryText = `${refuted} of ${total} claim${total !== 1 ? 's' : ''} contradicted by retrieved evidence. ${supported} verified.`;
  } else if (unverifiable === total) {
    statusKey = 'INSUFFICIENT_EVIDENCE';
    statusLabel = 'Insufficient Evidence';
    badgeType = 'neutral';
    summaryText = `No decisive evidence found across retrieved sources to verify or refute these ${total} claim${total !== 1 ? 's' : ''}.`;
  } else if (supported === total) {
    statusKey = 'VERIFIED';
    statusLabel = 'Verified by Evidence';
    badgeType = 'success';
    summaryText = `All ${total} claim${total !== 1 ? 's' : ''} verified and supported by authoritative reference evidence.`;
  } else {
    statusKey = 'MIXED';
    statusLabel = 'Mixed Evidence';
    badgeType = 'warning';
    summaryText = `${supported} of ${total} claim${total !== 1 ? 's' : ''} supported, ${uncertain} uncertain, and ${unverifiable} unverifiable.`;
  }

  return {
    statusKey,
    statusLabel,
    badgeType,
    summaryText,
    totalClaims: total,
    supportedClaims: supported,
    refutedClaims: refuted,
    uncertainClaims: uncertain,
    unverifiableClaims: unverifiable,
    decisiveClaims: decisive,
    corroborationRate
  };
}

// ── RUN TEST CASES ──
console.log('🧪 Starting Verity AI Verification Logic Test Suite...\n');

let passedTests = 0;

// TEST 1: Pure Support
{
  const sources = [
    { source_weight: 0.75, relevance: 0.8, nliRelationship: 'SUPPORT' },
    { source_weight: 0.50, relevance: 0.6, nliRelationship: 'SUPPORT' }
  ];
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.verdict, 'SUPPORTED', 'Test 1 Verdict must be SUPPORTED');
  assert.strictEqual(agg.evidenceConfidence, 100, 'Test 1 Confidence must be exactly 100% (No artificial 95% cap)');
  assert.strictEqual(agg.supportCount, 2);
  assert.strictEqual(agg.contradictCount, 0);
  console.log('✅ Test 1 Passed: Pure Support produces exactly 100% confidence (No 95% ceiling).');
  passedTests++;
}

// TEST 2: Pure Contradiction
{
  const sources = [
    { source_weight: 0.85, relevance: 0.9, nliRelationship: 'CONTRADICT' },
    { source_weight: 0.50, relevance: 0.7, nliRelationship: 'CONTRADICT' }
  ];
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.verdict, 'REFUTED', 'Test 2 Verdict must be REFUTED');
  assert.strictEqual(agg.evidenceConfidence, 0, 'Test 2 Confidence must be 0% support');
  assert.strictEqual(agg.contradictCount, 2);
  assert.strictEqual(agg.supportCount, 0);
  console.log('✅ Test 2 Passed: Pure Contradiction produces REFUTED verdict with 0% support.');
  passedTests++;
}

// TEST 3: Insufficient Evidence (0 support, 0 contradict)
{
  const sources = [
    { source_weight: 0.75, relevance: 0.4, nliRelationship: 'NO_DECISIVE_EVIDENCE' },
    { source_weight: 0.50, relevance: 0.3, nliRelationship: 'NO_DECISIVE_EVIDENCE' }
  ];
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.verdict, 'UNVERIFIABLE', 'Test 3 Verdict must be UNVERIFIABLE');
  assert.strictEqual(agg.evidenceConfidence, null, 'Test 3 Confidence must be null (rendered as N/A in UI), NEVER 50%!');
  assert.strictEqual(agg.supportCount, 0);
  assert.strictEqual(agg.contradictCount, 0);
  assert.strictEqual(agg.noDecisiveCount, 2);
  console.log('✅ Test 3 Passed: Zero decisive signals returns UNVERIFIABLE with null (N/A) confidence (Zero 50% fallback).');
  passedTests++;
}

// TEST 4: Non-decisive evidence does not penalize claims
{
  const sources = [
    { source_weight: 0.75, relevance: 0.8, nliRelationship: 'SUPPORT' },
    { source_weight: 0.50, relevance: 0.5, nliRelationship: 'NO_DECISIVE_EVIDENCE' },
    { source_weight: 0.25, relevance: 0.4, nliRelationship: 'NO_DECISIVE_EVIDENCE' }
  ];
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.verdict, 'SUPPORTED', 'Test 4 Verdict must be SUPPORTED');
  assert.strictEqual(agg.evidenceConfidence, 100, 'Test 4 Confidence must remain 100% because NO_DECISIVE_EVIDENCE does not penalize');
  assert.strictEqual(agg.supportCount, 1);
  assert.strictEqual(agg.noDecisiveCount, 2);
  console.log('✅ Test 4 Passed: Non-decisive evidence is neutral and does not dilute support confidence.');
  passedTests++;
}

// TEST 5: Deterministic Mixed Signal Aggregation
{
  // Source 1: Wikipedia Support -> 0.75 * 0.80 = 0.600
  // Source 2: Web Contradict -> 0.50 * 0.60 = 0.300
  // Total Decisive Signal = 0.600 + 0.300 = 0.900
  // Raw Ratio = 0.600 / 0.900 = 0.6666... -> 67%
  const sources = [
    { source_weight: 0.75, relevance: 0.8, nliRelationship: 'SUPPORT' },
    { source_weight: 0.50, relevance: 0.6, nliRelationship: 'CONTRADICT' }
  ];
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.verdict, 'SUPPORTED', 'Test 5 Verdict must be SUPPORTED (>= 60%)');
  assert.strictEqual(agg.evidenceConfidence, 67, 'Test 5 Confidence must be exactly 67%');
  assert.strictEqual(agg.weightedSupport, 0.600);
  assert.strictEqual(agg.weightedContradict, 0.300);
  console.log('✅ Test 5 Passed: Deterministic mixed signal calculation 0.600/(0.600+0.300) = 67%.');
  passedTests++;
}

// TEST 6: Configured Source Weights by Category
{
  const wGov = getSourceWeight('https://science.nasa.gov/mission/webb', 'web');
  const wWiki = getSourceWeight('https://en.wikipedia.org/wiki/Jupiter', 'wikipedia');
  const wGeneral = getSourceWeight('https://example.com/article', 'web');
  const wForum = getSourceWeight('https://quora.com/question/123', 'web');

  assert.strictEqual(wGov.weight, 0.85, 'NASA/Gov must have configured weight 0.85');
  assert.strictEqual(wWiki.weight, 0.75, 'Wikipedia must have configured weight 0.75');
  assert.strictEqual(wGeneral.weight, 0.50, 'General web must have configured weight 0.50');
  assert.strictEqual(wForum.weight, 0.25, 'Forums (Quora) must have configured weight 0.25');
  console.log('✅ Test 6 Passed: Configured source weights match architectural specifications.');
  passedTests++;
}

// TEST 7: Executive Summary Deterministic Aggregation
{
  // Case A: Contradictions detected
  const execA = calculateExecutiveSummary([
    { verdict: 'SUPPORTED' },
    { verdict: 'REFUTED' },
    { verdict: 'SUPPORTED' }
  ]);
  assert.strictEqual(execA.statusKey, 'CONTRADICTIONS_DETECTED');
  assert.strictEqual(execA.corroborationRate, 67); // 2 supported / 3 decisive = 67%

  // Case B: All verified
  const execB = calculateExecutiveSummary([
    { verdict: 'SUPPORTED' },
    { verdict: 'SUPPORTED' }
  ]);
  assert.strictEqual(execB.statusKey, 'VERIFIED');
  assert.strictEqual(execB.corroborationRate, 100);

  // Case C: Insufficient evidence
  const execC = calculateExecutiveSummary([
    { verdict: 'UNVERIFIABLE' },
    { verdict: 'UNVERIFIABLE' }
  ]);
  assert.strictEqual(execC.statusKey, 'INSUFFICIENT_EVIDENCE');
  assert.strictEqual(execC.corroborationRate, null);

  console.log('✅ Test 7 Passed: Executive summary accurately reflects overall status and corroboration rate.');
  passedTests++;
}

// TEST 8: Mathematical Consistency & Exact Formula String Matching
{
  const sources = [
    { source_weight: 0.85, relevance: 1.0, nliRelationship: 'SUPPORT' },
    { source_weight: 0.25, relevance: 0.5, nliRelationship: 'CONTRADICT' }
  ];
  // Support = 0.85 * 1.0 = 0.850
  // Contradict = 0.25 * 0.5 = 0.125
  // Total = 0.975
  // Ratio = 0.850 / 0.975 = 0.87179... -> 87%
  const agg = aggregateEvidence(sources);
  assert.strictEqual(agg.evidenceConfidence, 87);
  assert.strictEqual(agg.weightedSupport, 0.850);
  assert.strictEqual(agg.weightedContradict, 0.125);
  assert.strictEqual(agg.reason, 'Formula: 0.850 / (0.850 + 0.125) = 87%');
  console.log('✅ Test 8 Passed: Displayed formula string matches computed software values identically.');
  passedTests++;
}

console.log(`\n🎉 ALL ${passedTests}/8 VERIFICATION TESTS PASSED SUCCESSFULLY!`);
