// ============================================
// Verity AI — Evidence-First Background Service Worker
// Architecture: Retrieve → NLI Compare → Aggregate → Verdict → Evidence-Only Explanation
// NO independent AI truth judgments. All verdicts are evidence-driven.
// ============================================

console.log('🔍 Verity AI Evidence-First Service Worker initializing...');

// Setup context menus and side panel behavior on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "checkHallucination",
    title: "🔍 Check with Verity AI",
    contexts: ["selection"]
  });

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn("Could not set panel behavior:", err);
    });
  }

  console.log("✅ Verity AI Evidence-First installed successfully.");
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "checkHallucination" && info.selectionText) {
    chrome.storage.local.set({
      selectedText: info.selectionText,
      timestamp: Date.now()
    }, () => {
      if (tab?.id && chrome.sidePanel?.open) {
        chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
          console.warn("Could not open side panel for tab:", err);
        });
      }
    });
  }
});

// Session-safe state helpers
const StateStore = {
  async get() {
    try {
      if (chrome.storage.session) {
        const res = await chrome.storage.session.get('verityState');
        return res.verityState || null;
      }
    } catch {}
    const res = await chrome.storage.local.get('veritySessionState');
    return res.veritySessionState || null;
  },
  async set(state) {
    try {
      if (chrome.storage.session) {
        await chrome.storage.session.set({ verityState: state });
        return;
      }
    } catch {}
    await chrome.storage.local.set({ veritySessionState: state });
  },
  async clear() {
    try {
      if (chrome.storage.session) {
        await chrome.storage.session.remove('verityState');
      }
    } catch {}
    await chrome.storage.local.remove('veritySessionState');
  }
};

// ============================================
// SOURCE RELIABILITY TABLE (deterministic, no LLM)
// ============================================
// CONFIGURED SOURCE WEIGHTS (deterministic system weights)
// ============================================
// Predefined category weights. Note: These are system configuration weights,
// NOT empirical measurements of source accuracy.
const SOURCE_TYPE_WEIGHTS = {
  authoritative: 0.85, // .gov, .edu, official institutions, established reference/news
  wikipedia: 0.75,     // Peer-edited collaborative encyclopedia
  web_general: 0.50,   // General indexed web content
  low_authority: 0.25, // Unmoderated user-generated forums (Quora, Brainly, Reddit, Facebook)
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

  // Low-authority user-submitted forums & social media
  if (u.includes('quora.com') || u.includes('brainly.com') || u.includes('reddit.com') || 
      u.includes('facebook.com') || u.includes('twitter.com') || u.includes('x.com') ||
      u.includes('instagram.com') || u.includes('tiktok.com') || u.includes('answers.yahoo.com') ||
      u.includes('pinterest.com')) {
    return {
      weight: SOURCE_TYPE_WEIGHTS.low_authority,
      category: 'low_authority',
      label: 'Community Forum / UGC',
      domain: domain || 'forum'
    };
  }

  // High-authority domains: academic, government, major scientific & reference organizations
  if (u.includes('.gov') || u.includes('.edu') || u.includes('nasa.gov') || u.includes('nih.gov') ||
      u.includes('nature.com') || u.includes('sciencemag.org') || u.includes('britannica.com') ||
      u.includes('reuters.com') || u.includes('apnews.com') || u.includes('bbc.com') || u.includes('bbc.co.uk') ||
      u.includes('who.int') || u.includes('un.org')) {
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

// Backward-compatibility wrapper
function getSourceReliability(sourceType) {
  return getSourceWeight('', sourceType).weight;
}

// ============================================
// RETRIEVAL RELEVANCE (deterministic lexical match, no LLM)
// ============================================
// Measures the proportion of meaningful claim keywords found in the source snippet.
function scoreRelevance(claim, snippet) {
  if (!claim || !snippet) return 0.2;
  const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may','might',
    'shall','can','need','dare','ought','used','in','on','at','to','for','of','and',
    'or','but','not','with','by','from','that','this','which','who','what','when',
    'where','how','why','it','its','than','as','if','then','so','up','out','about']);
  // Words with length >= 3 (captures key nouns: sun, eye, war, moon, red, dna)
  const claimWords = claim.toLowerCase().split(/\W+/).filter(w => w.length >= 3 && !stopWords.has(w));
  if (claimWords.length === 0) return 0.3;
  const snippetLower = snippet.toLowerCase();
  const matches = claimWords.filter(w => snippetLower.includes(w)).length;
  const ratio = matches / claimWords.length;
  // Baseline floor of 0.25 for retrieved search results
  return Math.min(1.0, Math.max(0.25, ratio));
}

// ============================================
// EVIDENCE AGGREGATION (deterministic, no LLM)
// ============================================
// Each source signal = source_weight × retrieval_relevance.
// Only decisive signals (SUPPORT, CONTRADICT) determine the confidence score.
// NO_DECISIVE_EVIDENCE indicates absence of decisive proof and does NOT act as contradiction.
// Formula: Weighted Support / (Weighted Support + Weighted Contradict) * 100
// NO hidden caps (no 95% ceiling). If support-only, score is exactly 100%.
// If support == 0 AND contradict == 0, confidence is null (N/A) — NOT 50%!
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

  // CRITICAL: When both decisive signals are zero, formula is undefined.
  // Return null (rendered as N/A in UI), NOT 50%!
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

  // Exact mathematical ratio: Support / (Support + Contradict)
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

// ============================================
// VERIFICATION ENGINE
// ============================================
class VerityEngine {
  constructor() {
    this.lastCallTime = 0;
    this.MIN_CALL_GAP_MS = 600;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getApiKeys() {
    const keys = await chrome.storage.local.get(['groqApiKey', 'serpApiKey']);
    return {
      groq: (keys.groqApiKey || '').trim(),
      serpapi: (keys.serpApiKey || '').trim()
    };
  }

  // Centralized Groq LLM caller — structured JSON output mode
  async groqCall(messages, maxTokens = 500, temperature = 0.05) {
    const { groq } = await this.getApiKeys();
    if (!groq) {
      throw new Error('MISSING_GROQ_KEY: Please configure your Groq API key in Settings (⚙️).');
    }

    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.MIN_CALL_GAP_MS) {
      await this.sleep(this.MIN_CALL_GAP_MS - elapsed);
    }
    this.lastCallTime = Date.now();

    // Diagnostic (safe — prefix only)
    console.log('[VerityAI] Groq key exists:', !!groq);
    console.log('[VerityAI] Groq key length:', groq.length);
    console.log('[VerityAI] Groq key prefix:', groq.slice(0, 7));

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groq}`
          },
          body: JSON.stringify({
            messages,
            model: 'openai/gpt-oss-20b',
            temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' }
          })
        });

        if (response.status === 401) {
          const errBody = await response.text();
          console.error('[VerityAI] 401 body from Groq:', errBody);
          throw new Error('INVALID_API_KEY: Groq API key is invalid or revoked (401). Please update it in Settings (⚙️).');
        }

        if (response.status === 429) {
          attempts++;
          const wait = attempts * 2500;
          console.warn(`Groq 429 rate limit. Retrying in ${wait}ms (${attempts}/${maxAttempts})...`);
          await this.sleep(wait);
          continue;
        }

        if (!response.ok) {
          const errBody = await response.text();
          let msg = errBody;
          try { msg = JSON.parse(errBody)?.error?.message || errBody; } catch {}
          throw new Error(`Groq API Error (${response.status}): ${msg}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '{}';
      } catch (error) {
        if (error.message.includes('INVALID_API_KEY') || error.message.includes('MISSING_GROQ_KEY')) {
          throw error;
        }
        attempts++;
        if (attempts >= maxAttempts) throw error;
        await this.sleep(1500 * attempts);
      }
    }
  }

  // Robust JSON extractor
  extractJson(raw) {
    if (!raw || typeof raw !== 'string') throw new Error('Empty LLM response');
    let cleaned = raw.trim();
    // 1. Strip reasoning blocks if present (<think>...</think>)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // 2. Strip markdown fences if present
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    try { return JSON.parse(cleaned); } catch {}
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error('Unable to parse JSON from LLM: ' + cleaned.substring(0, 150));
  }

  sendProgress(data) {
    chrome.runtime.sendMessage({ action: 'analysisProgress', ...data }).catch(() => {});
  }

  // ── STEP 1: Extract individual verifiable claims from the full text (LLM) ──
  // LLM role: segmentation only. Not asked to judge truth.
  splitIntoSentences(text) {
    let clean = (text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const abbreviations = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Sr.', 'Jr.', 'etc.', 'vs.', 'e.g.', 'i.e.', 'U.S.', 'U.K.', 'Jan.', 'Feb.', 'approx.'];
    const map = new Map();
    abbreviations.forEach((abbr, idx) => {
      const token = `___ABBR_${idx}___`;
      map.set(token, abbr);
      clean = clean.split(abbr).join(token);
    });
    const rawSegments = clean.split(/(?<=[.!?])(?:\s+|(?=["']))/);
    const restored = rawSegments.map(seg => {
      let s = seg.trim();
      map.forEach((orig, token) => { s = s.split(token).join(orig); });
      return s;
    }).filter(s => s.length >= 8);
    return restored.length > 0 ? restored : [clean];
  }

  // ── STEP 2: NLI Classification — LLM role is ONLY to classify claim vs evidence ──
  // The LLM is NOT asked whether the claim is true from its own knowledge.
  // It is asked ONLY: given this evidence passage, does it SUPPORT, CONTRADICT, or is NO_DECISIVE_EVIDENCE to the claim?
  async nliClassify(claim, evidenceSnippet) {
    if (!evidenceSnippet || evidenceSnippet.trim().length < 10) {
      return { relationship: 'NO_DECISIVE_EVIDENCE', rationale: 'Snippet is empty or insufficient.' };
    }
    try {
      const messages = [
        {
          role: 'system',
          content: `You are an NLI (Natural Language Inference) evidence classifier for a strict fact-verification engine.
Given a CLAIM and an EVIDENCE passage, classify their factual relationship into exactly ONE category:

1. SUPPORT: The evidence passage directly confirms, validates, or proves the factual assertion in the claim.
2. CONTRADICT: The evidence passage directly refutes the claim OR states mutually exclusive facts that prove the claim false.
   * CRITICAL SEMANTIC CONTRADICTION RULE:
     If the claim asserts that X possesses a property, superlative, quantity, date, or identity (e.g., "Mars is the largest planet in our solar system"), and the evidence asserts that a different entity possesses that property, superlative, quantity, date, or identity (e.g., "Jupiter is the largest planet in the Solar System"), these facts are mutually exclusive. You MUST classify this as CONTRADICT, NOT as NO_DECISIVE_EVIDENCE.
     Likewise, if the claim asserts a specific date or number ("founded in 1995") and the evidence states a different date or number ("founded in 1998"), classify as CONTRADICT.
3. NO_DECISIVE_EVIDENCE: The evidence passage discusses the general topic, entities, or background context, but does NOT contain decisive facts to either confirm or refute the specific assertion in the claim.

RULES:
- Do NOT use pretrained memory to decide truth. Analyze ONLY the logical entailment/contradiction between CLAIM and EVIDENCE.
- Do NOT output any numerical confidence score.
- Provide a clear 1-sentence rationale explaining the classification.

Return ONLY this JSON format:
{
  "relationship": "SUPPORT" | "CONTRADICT" | "NO_DECISIVE_EVIDENCE",
  "rationale": "One concise sentence explaining why."
}`
        },
        {
          role: 'user',
          content: `CLAIM: "${claim.substring(0, 300)}"

EVIDENCE PASSAGE:
"${evidenceSnippet.substring(0, 750)}"

Classify relationship:`
        }
      ];
      // 300 max_tokens to ensure sufficient room for JSON output
      const raw = await this.groqCall(messages, 300, 0.0);
      const parsed = this.extractJson(raw);
      let rel = (parsed.relationship || '').toUpperCase().trim();
      if (rel === 'NEUTRAL') rel = 'NO_DECISIVE_EVIDENCE';
      if (!['SUPPORT', 'CONTRADICT', 'NO_DECISIVE_EVIDENCE'].includes(rel)) {
        rel = 'NO_DECISIVE_EVIDENCE';
      }
      return {
        relationship: rel,
        rationale: parsed.rationale || `Classified as ${rel} based on provided evidence passage.`
      };
    } catch (err) {
      if (err.message.includes('INVALID_API_KEY') || err.message.includes('MISSING_GROQ_KEY')) {
        throw err;
      }
      console.warn('[NLI] Classification failed:', err.message);
      return { relationship: 'NO_DECISIVE_EVIDENCE', rationale: 'Classification error encountered.' };
    }
  }

  // ── STEP 3: Source retrieval (Wikipedia + SerpAPI) ──
  async fetchSources(claim, keys) {
    const sources = [];

    // Wikipedia (free, no key)
    try {
      const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(claim)}&utf8=&format=json&origin=*`;
      const wikiQuery = await fetch(wikiSearchUrl);
      if (wikiQuery.ok) {
        const wikiData = await wikiQuery.json();
        const topResults = (wikiData.query?.search || []).slice(0, 2);
        for (const item of topResults) {
          const title = item.title;
          const snippetClean = (item.snippet || '').replace(/<[^>]+>/g, '').trim();
          let fullSnippet = snippetClean;

          try {
            const wikiExtractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&explaintext=&titles=${encodeURIComponent(title)}&format=json&origin=*`;
            const extractResp = await fetch(wikiExtractUrl);
            if (extractResp.ok) {
              const extractData = await extractResp.json();
              const pages = extractData.query?.pages || {};
              const firstPage = Object.values(pages)[0];
              if (firstPage?.extract) {
                const intro = firstPage.extract.substring(0, 500);
                fullSnippet = snippetClean ? `${snippetClean}. ${intro}` : intro;
              }
            }
          } catch {}

          sources.push({
            source_id: `source_${sources.length + 1}`,
            title: `Wikipedia: ${title}`,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            snippet: fullSnippet || snippetClean,
            source: 'Wikipedia'
          });
        }
      }
    } catch (wikiErr) {
      console.warn('Wikipedia fetch error:', wikiErr.message);
    }

    // SerpAPI
    if (keys.serpapi) {
      try {
        const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(claim)}&num=3&api_key=${keys.serpapi}`;
        const serpResp = await fetch(serpUrl);
        if (serpResp.ok) {
          const serpData = await serpResp.json();
          if (Array.isArray(serpData.organic_results)) {
            serpData.organic_results.slice(0, 3).forEach((res, idx) => {
              if (res.link && res.title && res.snippet) {
                sources.push({
                  source_id: `source_${sources.length + 1}`,
                  title: res.title,
                  url: res.link,
                  snippet: res.snippet,
                  source: 'Web'
                });
              }
            });
          }
        }
      } catch (serpErr) {
        console.warn('SerpAPI error:', serpErr.message);
      }
    }

    return sources;
  }

  // ── STEP 4: Evidence-only explanation (LLM) ──
  // The LLM is given ONLY the claim + the evaluated evidence snippets.
  // It is explicitly forbidden from using its own knowledge.
  async generateEvidenceExplanation(claim, verdict, evidenceSources) {
    const supportingSources = evidenceSources.filter(s => s.nliRelationship === 'SUPPORT');
    const contradictingSources = evidenceSources.filter(s => s.nliRelationship === 'CONTRADICT');
    const allSignificant = [...supportingSources, ...contradictingSources];

    if (allSignificant.length === 0) {
      return 'No supporting or contradicting evidence was found in the retrieved sources. The claim is unverifiable with current search results.';
    }

    const evidenceText = allSignificant.map(s =>
      `[${s.source_id}] (${s.nliRelationship}) Source: "${s.title}"\nVerbatim Text: "${(s.snippet || '').substring(0, 350)}"`
    ).join('\n\n');

    try {
      const messages = [
        {
          role: 'system',
          content: `You are an evidence summarizer for a strict fact-checking system.

RULES:
1. Explain the verdict using ONLY the verbatim evidence provided below.
2. State specifically what each cited source says, using the source ID (e.g., [source_1]).
3. DO NOT use pretrained knowledge.
4. DO NOT invent facts, numbers, or dates not in the text.
5. If the claim mentions an exact figure (e.g. "exactly 100 billion neurons"), explain that the source does not support this exact figure without inventing a replacement total.
6. Keep the explanation to 2-3 clear, factual sentences.

Return ONLY this JSON:
{"explanation": "your source-grounded explanation here"}`
        },
        {
          role: 'user',
          content: `CLAIM: "${claim}"
VERDICT: ${verdict}

RETRIEVED SOURCE EVIDENCE:
${evidenceText}

Write an evidence-grounded explanation:`
        }
      ];

      const raw = await this.groqCall(messages, 600, 0.0);
      const parsed = this.extractJson(raw);
      if (parsed.explanation && parsed.explanation.trim().length > 15) {
        return parsed.explanation.trim();
      }
    } catch (err) {
      console.warn('[Explanation] LLM generation failed, using structured evidence fallback:', err.message);
    }

    // High-fidelity deterministic fallback citing actual retrieved snippets:
    const parts = [];
    if (contradictingSources.length > 0) {
      const cSummaries = contradictingSources.map(s => 
        `[${s.source_id}] (${s.title}) states: "${(s.snippet || '').substring(0, 140).trim()}..."`
      ).join(' ');
      parts.push(`${cSummaries} This contradicts the claim.`);
    }
    if (supportingSources.length > 0) {
      const sSummaries = supportingSources.map(s => 
        `[${s.source_id}] (${s.title}) states: "${(s.snippet || '').substring(0, 140).trim()}..."`
      ).join(' ');
      parts.push(`${sSummaries} This supports the claim.`);
    }

    return parts.join(' ') || 'Evidence evaluation complete based on cited sources.';
  }

  // ── MAIN CLAIM PIPELINE ──
  // Pipeline: Retrieve → NLI → Score → Aggregate → Explain
  // No independent AI truth judgment at any step.
  async verifySingleClaim(claim, index, keys) {
    this.sendProgress({ step: 'sources', message: `Claim ${index + 1}: Retrieving sources...` });
    const rawSources = await this.fetchSources(claim, keys);

    if (rawSources.length === 0) {
      return {
        index,
        claim,
        verdict: 'UNVERIFIABLE',
        evidence_confidence: null,
        evidenceConfidence: null,
        confidence: null,
        status: 'Insufficient evidence',
        sources: [],
        allSourcesChecked: [],
        supportingSources: [],
        contradictingSources: [],
        support_signal: 0,
        contradict_signal: 0,
        neutral_signal: 0,
        support_count: 0,
        contradict_count: 0,
        neutral_count: 0,
        supportCount: 0,
        contradictCount: 0,
        neutralCount: 0,
        explanation: 'No reference sources could be retrieved for this claim. The claim is unverifiable.',
        confidenceReasoning: 'Evidence Confidence: N/A\nReason: No reference sources could be retrieved.\nFormula: Support / (Support + Contradict) is undefined when both terms are zero.',
        aggregation: {
          evidenceConfidence: null,
          verdict: 'UNVERIFIABLE',
          status: 'Insufficient evidence',
          weightedSupport: 0,
          weightedContradict: 0,
          weightedNeutral: 0,
          supportCount: 0,
          contradictCount: 0,
          neutralCount: 0,
          formula: 'Undefined (Support = 0, Contradict = 0)',
          reason: 'No reference sources found.'
        }
      };
    }

    // ── NLI + score each source ──
    this.sendProgress({ step: 'nli', message: `Claim ${index + 1}: Comparing claim against ${rawSources.length} source(s)...` });
    const sourcesWithNLI = [];

    for (const src of rawSources) {
      const nliResult = await this.nliClassify(claim, src.snippet);
      const nliRelationship = typeof nliResult === 'object' ? nliResult.relationship : nliResult;
      const nliRationale = typeof nliResult === 'object' ? nliResult.rationale : '';

      const sourceWeightInfo = getSourceWeight(src.url, src.source);
      const relevance = scoreRelevance(claim, src.snippet);

      const enrichedSource = {
        source_id: src.source_id,
        title: src.title,
        url: src.url,
        snippet: src.snippet,
        source: src.source,
        sourceCategory: sourceWeightInfo.category,
        sourceLabel: sourceWeightInfo.label,
        source_weight: sourceWeightInfo.weight,
        reliability: sourceWeightInfo.weight, // compatibility
        relevance: +relevance.toFixed(3),
        nliRelationship,
        nliRationale,
        evidenceWeight: +(sourceWeightInfo.weight * relevance).toFixed(3)
      };

      sourcesWithNLI.push(enrichedSource);
    }

    // ── Aggregate evidence (deterministic) ──
    this.sendProgress({ step: 'aggregate', message: `Claim ${index + 1}: Aggregating evidence...` });
    const aggregation = aggregateEvidence(sourcesWithNLI);

    // ── Generate evidence-only explanation (LLM, constrained) ──
    this.sendProgress({ step: 'explain', message: `Claim ${index + 1}: Generating evidence-based explanation...` });
    const explanation = await this.generateEvidenceExplanation(claim, aggregation.verdict, sourcesWithNLI);

    // Formulate transparent explanation of confidence
    let confidenceReasoningText = '';
    if (aggregation.evidenceConfidence === null) {
      confidenceReasoningText = [
        `Evidence Confidence: N/A`,
        `Evidence Status: Insufficient evidence`,
        `Reason: No decisive supporting or contradicting evidence was found in the retrieved sources.`,
        `Formula: Support / (Support + Contradict) is undefined when both terms are zero.`
      ].join('\n');
    } else {
      confidenceReasoningText = [
        `Evidence Confidence: ${aggregation.evidenceConfidence}%`,
        `Formula: Support Signal / (Support Signal + Contradict Signal) × 100`,
        `Calculation: ${aggregation.weightedSupport.toFixed(3)} / (${aggregation.weightedSupport.toFixed(3)} + ${aggregation.weightedContradict.toFixed(3)}) = ${aggregation.evidenceConfidence}%`,
        `Signals: Support Signal = ${aggregation.weightedSupport.toFixed(3)} | Contradict Signal = ${aggregation.weightedContradict.toFixed(3)}`,
        `Counts: ${aggregation.supportCount} supporting, ${aggregation.contradictCount} contradicting, ${aggregation.noDecisiveCount} no decisive evidence`
      ].join('\n');
    }

    // Structured claim result object (Item 11)
    const result = {
      index,
      claim,
      verdict: aggregation.verdict,
      evidence_confidence: aggregation.evidenceConfidence,
      status: aggregation.status,
      sources: sourcesWithNLI.map(s => ({
        source_id: s.source_id,
        relationship: s.nliRelationship,
        rationale: s.nliRationale,
        evidence: s.snippet,
        url: s.url,
        title: s.title,
        source_type: s.sourceCategory,
        source_weight: s.source_weight,
        source_label: s.sourceLabel,
        retrieval_relevance: s.relevance
      })),
      support_signal: aggregation.weightedSupport,
      contradict_signal: aggregation.weightedContradict,
      neutral_signal: aggregation.weightedNoDecisive,
      no_decisive_signal: aggregation.weightedNoDecisive,
      support_count: aggregation.supportCount,
      contradict_count: aggregation.contradictCount,
      neutral_count: aggregation.noDecisiveCount,
      no_decisive_count: aggregation.noDecisiveCount,
      explanation,

      // UI compatibility aliases
      evidenceConfidence: aggregation.evidenceConfidence,
      confidence: aggregation.evidenceConfidence,
      confidenceReasoning: confidenceReasoningText,
      supportCount: aggregation.supportCount,
      contradictCount: aggregation.contradictCount,
      neutralCount: aggregation.noDecisiveCount,
      noDecisiveCount: aggregation.noDecisiveCount,
      allSourcesChecked: sourcesWithNLI.map(s => ({
        source_id: s.source_id,
        title: s.title,
        url: s.url,
        snippet: s.snippet,
        source: s.source,
        sourceType: s.sourceCategory,
        source_weight: s.source_weight,
        sourceLabel: s.sourceLabel,
        quality: s.source_weight >= 0.75 ? 'high' : 'medium',
        fullText: s.snippet,
        nliRelationship: s.nliRelationship,
        nliRationale: s.nliRationale,
        aiAlignment: s.nliRelationship === 'SUPPORT' ? 'supports'
                   : s.nliRelationship === 'CONTRADICT' ? 'contradicts'
                   : 'no_decisive_evidence',
        reliability: s.source_weight,
        relevance: s.relevance,
        evidenceWeight: s.evidenceWeight
      })),
      aggregation
    };

    result.supportingSources = result.allSourcesChecked.filter(s => s.nliRelationship === 'SUPPORT');
    result.contradictingSources = result.allSourcesChecked.filter(s => s.nliRelationship === 'CONTRADICT');

    return result;
  }

  // ── FULL TEXT PIPELINE ──
  async verifyText(text, prompt = '') {
    const keys = await this.getApiKeys();
    if (!keys.groq) {
      throw new Error('MISSING_GROQ_KEY: Please configure your Groq API key in Settings (⚙️).');
    }

    const results = {
      text,
      prompt,
      timestamp: new Date().toISOString(),
      sentences: [],
      overallVerdict: null,
      trustScore: null,
      trustability: null,
      methodology: {
        description: 'Evidence-First: Retrieve → NLI Compare → Aggregate → Deterministic Verdict → Evidence-Only Explanation.',
        sourceDependent: true,
        verificationApproach: 'NLI-based evidence aggregation. No independent AI truth judgment.'
      }
    };

    const claims = this.splitIntoSentences(text);
    const total = claims.length;

    for (let i = 0; i < total; i++) {
      const startPct = 15 + Math.round((i / total) * 75);
      this.sendProgress({
        step: 'claim',
        current: i + 1,
        total,
        percent: startPct,
        message: `Verifying claim ${i + 1} of ${total}: "${claims[i].substring(0, 45)}..."`
      });
      const claimResult = await this.verifySingleClaim(claims[i], i, keys);
      results.sentences.push(claimResult);
    }

    this.sendProgress({ step: 'aggregating', percent: 95, message: 'Computing overall trust score...' });
    results.overallVerdict = this.calculateOverallVerdict(results.sentences);
    results.trustScore = this.calculateTrustScore(results.sentences);
    results.trustability = this.generateTrustability(results.trustScore, results.sentences);
    results.executiveSummary = this.calculateExecutiveSummary(results.sentences);

    await StateStore.set({
      lastResults: results,
      lastText: text,
      lastPrompt: prompt,
      timestamp: Date.now()
    });

    this.sendProgress({ step: 'complete', percent: 100, message: 'Analysis complete!' });
    return results;
  }

  // ── EXECUTIVE SUMMARY (deterministic) ──
  calculateExecutiveSummary(sentences) {
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

  // ── OVERALL VERDICT (deterministic) ──
  calculateOverallVerdict(sentences) {
    if (!sentences || sentences.length === 0) return { verdict: 'UNVERIFIABLE' };
    const refutedCount = sentences.filter(s => s.verdict === 'REFUTED').length;
    const supportedCount = sentences.filter(s => s.verdict === 'SUPPORTED').length;
    const unverifiableCount = sentences.filter(s => s.verdict === 'UNVERIFIABLE').length;
    if (refutedCount > 0 && supportedCount > 0) return { verdict: 'MIXED' };
    if (refutedCount > 0) return { verdict: 'HAS_REFUTED_CLAIMS' };
    if (supportedCount === sentences.length) return { verdict: 'ALL_SUPPORTED' };
    if (unverifiableCount === sentences.length) return { verdict: 'UNVERIFIABLE' };
    return { verdict: 'MIXED' };
  }

  // ── TRUST SCORE (deterministic, evidence-based) ──
  // Formula: (Supported Claims / Total Claims) * 100
  // Traceable, transparent, no arbitrary penalty constants.
  calculateTrustScore(sentences) {
    if (!sentences || sentences.length === 0) return 0;
    const total = sentences.length;
    const supported = sentences.filter(s => s.verdict === 'SUPPORTED').length;
    return Math.round((supported / total) * 100);
  }

  generateTrustability(trustScore, sentences) {
    const total = sentences.length;
    const supported = sentences.filter(s => s.verdict === 'SUPPORTED').length;
    const refuted = sentences.filter(s => s.verdict === 'REFUTED').length;
    const uncertain = sentences.filter(s => s.verdict === 'UNCERTAIN').length;
    const unverifiable = sentences.filter(s => s.verdict === 'UNVERIFIABLE').length;

    let level, recommendation, reasoning;
    if (trustScore >= 75) {
      level = 'HIGH';
      recommendation = '✅ Evidence Strongly Supports Text';
      reasoning = `${supported} of ${total} claims are directly supported by retrieved evidence.`;
    } else if (trustScore >= 50) {
      level = 'MODERATE';
      recommendation = '⚠️ Partially Corroborated';
      reasoning = `${supported} supported, ${refuted} refuted, and ${uncertain + unverifiable} uncertain/unverifiable out of ${total} claims.`;
    } else if (trustScore >= 25) {
      level = 'LOW';
      recommendation = '⚠️ Low Evidence Support';
      reasoning = `Only ${supported} of ${total} claims supported by evidence (${refuted} refuted).`;
    } else {
      level = 'VERY LOW';
      recommendation = '❌ Evidence Contradicts Text';
      reasoning = `${refuted} of ${total} claims refuted by evidence (${supported} supported).`;
    }

    return {
      canTrust: trustScore >= 60,
      level,
      trustScore,
      recommendation,
      reasoning,
      formulaExplanation: `Deterministic Formula: (Supported Claims [${supported}] ÷ Total Claims [${total}]) × 100 = ${trustScore}%`,
      breakdown: { verified: supported, false: refuted, uncertain: uncertain + unverifiable, total }
    };
  }

  // ── FAITHFULNESS ANALYSIS (LLM, unchanged — measures prompt adherence, not external facts) ──
  async analyzeFaithfulness(text, prompt) {
    try {
      const messages = [{
        role: 'system',
        content: `Evaluate faithfulness of the generated response to the original prompt across 3 metrics: Logical Consistency, Contextual Alignment, and Instruction Adherence.
Return valid JSON:
{
  "overallConclusion": "FAITHFUL|PARTIALLY_FAITHFUL|UNFAITHFUL",
  "overallConfidence": 0-100,
  "metrics": {
    "logicalConsistency": { "score": 0-100, "passed": true, "analysis": "explanation" },
    "contextualAlignment": { "score": 0-100, "passed": true, "analysis": "explanation" },
    "instructionAdherence": { "score": 0-100, "passed": true, "analysis": "explanation" }
  },
  "summary": "One sentence summary",
  "detailedExplanation": "Detailed assessment paragraph"
}`
      }, {
        role: 'user',
        content: `Original Prompt: "${prompt}"\n\nAI Response: "${text}"\n\nAnalyze faithfulness.`
      }];
      const content = await this.groqCall(messages, 900);
      return this.extractJson(content);
    } catch (error) {
      console.warn('Faithfulness check fallback:', error.message);
      return {
        overallConclusion: 'PARTIALLY_FAITHFUL',
        overallConfidence: 50,
        metrics: {
          logicalConsistency: { score: 50, passed: false, analysis: 'Could not evaluate.' },
          contextualAlignment: { score: 50, passed: false, analysis: 'Could not evaluate.' },
          instructionAdherence: { score: 50, passed: false, analysis: 'Could not evaluate.' }
        },
        summary: 'Faithfulness assessment incomplete.',
        detailedExplanation: 'Check API credentials in Settings.'
      };
    }
  }
}

// ============================================
// Message Handlers
// ============================================
const engine = new VerityEngine();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeText') {
    engine.verifyText(request.text, request.prompt || '')
      .then(results => sendResponse({ success: true, results }))
      .catch(error => {
        console.error('Analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'analyzeFaithfulness') {
    engine.analyzeFaithfulness(request.text, request.prompt)
      .then(results => sendResponse({ success: true, results }))
      .catch(error => {
        console.error('Faithfulness error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'getState') {
    StateStore.get().then(state => {
      sendResponse({ success: true, hasState: !!(state && state.lastResults), state });
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'saveState') {
    StateStore.set({ ...request.state, timestamp: Date.now() })
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'clearState') {
    StateStore.clear()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'testApiKey') {
    const key = (request.key || '').trim();
    if (!key) { sendResponse({ success: false, error: 'Key is empty' }); return true; }
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 50
      })
    }).then(async res => {
      if (res.ok) {
        sendResponse({ success: true });
      } else {
        const errText = await res.text();
        sendResponse({ success: false, status: res.status, error: `Groq error (${res.status}): ${errText}` });
      }
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

console.log('✅ Verity AI Evidence-First Service Worker Ready.');