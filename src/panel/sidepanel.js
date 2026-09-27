// ============================================
// Verity AI — Panel Controller
// Adapted for the new MNC-grade design system
// ============================================

'use strict';

let currentResults    = null;
let currentText       = '';
let currentPrompt     = '';
let faithfulnessResults = null;
let fullscreenWindowId  = null;

// ── DOM references ──────────────────────────────────────────
const el = {
  // Topbar
  navChatBtn:       document.getElementById('navChatBtn'),
  navResultsBtn:    document.getElementById('navResultsBtn'),
  themeToggle:      document.getElementById('themeToggle'),
  fullscreenToggle: document.getElementById('fullscreenToggle'),
  settingsToggle:   document.getElementById('settingsToggle'),

  // Sections (views)
  inputSection:   document.getElementById('inputSection'),
  loadingSection: document.getElementById('loadingSection'),
  resultsSection: document.getElementById('resultsSection'),

  // Inputs
  textInput:   document.getElementById('textInput'),
  promptInput: document.getElementById('promptInput'),

  // Action buttons
  analyzeBtn:        document.getElementById('analyzeBtn'),
  clearBtn:          document.getElementById('clearBtn'),
  newAnalysisBtn:    document.getElementById('newAnalysisBtn'),
  backToChatTopBtn:  document.getElementById('backToChatTopBtn'),
  downloadPdfBtn:    document.getElementById('downloadPdfBtn'),

  // Progress
  progressBarFill: document.getElementById('progressBarFill'),
  progressLabel:   document.getElementById('progressLabel'),
  loadingMessage:  document.getElementById('loadingMessage'),
  loadingTitle:    document.getElementById('loadingTitle'),

  // Results displays
  factualBtn:              document.getElementById('factualBtn'),
  faithfulnessBtn:         document.getElementById('faithfulnessBtn'),
  factualView:             document.getElementById('factualView'),
  faithfulnessView:        document.getElementById('faithfulnessView'),
  executiveSummaryDisplay: document.getElementById('executiveSummaryDisplay'),
  trustScoreDisplay:       document.getElementById('trustScoreDisplay'),
  sentenceBreakdown:       document.getElementById('sentenceBreakdown'),
  faithfulnessDisplay:     document.getElementById('faithfulnessDisplay'),

  // Settings modal
  settingsModal:       document.getElementById('settingsModal'),
  closeSettingsBtn:    document.getElementById('closeSettingsBtn'),
  cancelSettingsBtn:   document.getElementById('cancelSettingsBtn'),
  saveSettingsBtn:     document.getElementById('saveSettingsBtn'),
  resetDefaultKeysBtn: document.getElementById('resetDefaultKeysBtn'),
  testGroqKeyBtn:      document.getElementById('testGroqKeyBtn'),
  testKeyResult:       document.getElementById('testKeyResult'),
  groqApiKeyInput:     document.getElementById('groqApiKeyInput'),
  serpApiKeyInput:     document.getElementById('serpApiKeyInput'),
  settingsStatus:      document.getElementById('settingsStatus'),
};

// ══════════════════════════════════════════════════════════════
// SECURITY HELPERS
// ══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  const t = url.trim();
  if (t.startsWith('https://') || t.startsWith('http://')) return escapeHtml(t);
  return '#';
}

function extractDomain(url = '') {
  try {
    if (!url.startsWith('http')) return url;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    const m = url.match(/https?:\/\/(?:www\.)?([^\/\?#]+)/i);
    return m ? m[1] : 'web';
  }
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  initEvents();
  loadTheme();
  checkForSelectedText();
  await restoreState();
  detectWindowType();
  listenToProgress();
});

function detectWindowType() {
  chrome.windows.getCurrent((win) => {
    if (win && win.type === 'popup') {
      fullscreenWindowId = win.id;
      if (el.fullscreenToggle) {
        el.fullscreenToggle.title = 'Close Window';
        el.fullscreenToggle.onclick = () => chrome.windows.remove(win.id);
        el.fullscreenToggle.querySelector('svg').innerHTML =
          '<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
      }
    }
  });
}

function listenToProgress() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'analysisProgress') return;
    if (msg.percent && el.progressBarFill) {
      el.progressBarFill.style.width = `${Math.min(100, Math.max(5, msg.percent))}%`;
    }
    if (msg.message && el.progressLabel) {
      el.progressLabel.textContent = msg.message;
    }
    if (msg.message && el.loadingMessage) {
      el.loadingMessage.textContent = msg.message;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════

function initEvents() {
  // Navigation
  el.navChatBtn?.addEventListener('click', goToChat);
  el.navResultsBtn?.addEventListener('click', goToResults);

  // Analysis
  el.analyzeBtn?.addEventListener('click', startAnalysis);
  el.clearBtn?.addEventListener('click', clearInput);
  el.newAnalysisBtn?.addEventListener('click', goToChat);
  el.backToChatTopBtn?.addEventListener('click', goToChat);
  el.downloadPdfBtn?.addEventListener('click', downloadPDF);

  // Ctrl+Enter shortcut
  el.textInput?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') startAnalysis();
  });

  // Theme / fullscreen / settings
  el.themeToggle?.addEventListener('click', toggleTheme);
  el.fullscreenToggle?.addEventListener('click', openFullscreen);
  el.settingsToggle?.addEventListener('click', openSettings);

  // Settings modal
  el.closeSettingsBtn?.addEventListener('click', closeSettings);
  el.cancelSettingsBtn?.addEventListener('click', closeSettings);
  el.saveSettingsBtn?.addEventListener('click', saveApiKeys);
  el.resetDefaultKeysBtn?.addEventListener('click', resetKeys);
  el.testGroqKeyBtn?.addEventListener('click', testGroqKey);

  el.settingsModal?.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.settingsModal?.style.display !== 'none') closeSettings();
  });

  // Toggle password visibility
  document.querySelectorAll('.input-action-btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      // Swap eye icon
      const eyeSvg = btn.querySelector('svg');
      if (eyeSvg) {
        eyeSvg.innerHTML = showing
          ? '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>'
          : '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/><path d="M2 2l12 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
      }
    });
  });

  // View tabs
  el.factualBtn?.addEventListener('click', () => switchView('factual'));
  el.faithfulnessBtn?.addEventListener('click', () => switchView('faithfulness'));

  // Delegated clicks — drawer toggles & source links
  document.addEventListener('click', (e) => {
    const expandBtn = e.target.closest('[data-drawer-index]');
    if (expandBtn) {
      toggleDrawer(parseInt(expandBtn.dataset.drawerIndex, 10));
      return;
    }
    const link = e.target.closest('.source-link');
    if (link && link.href && link.href !== '#') {
      e.preventDefault();
      chrome.tabs.create({ url: link.href });
    }
  });
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════

function showView(id) {
  ['inputSection', 'loadingSection', 'resultsSection'].forEach((sid) => {
    const sec = document.getElementById(sid);
    if (sec) sec.classList.toggle('active', sid === id);
  });
}

function goToChat() {
  closeSettings();
  showView('inputSection');
  el.navChatBtn?.classList.add('active');
  el.navResultsBtn?.classList.remove('active');
  el.textInput?.focus();
}

function goToResults() {
  closeSettings();
  if (!currentResults) { goToChat(); return; }
  showView('resultsSection');
  el.navResultsBtn?.classList.add('active');
  el.navChatBtn?.classList.remove('active');
}

function switchView(view) {
  const isFactual = view === 'factual';
  el.factualBtn?.classList.toggle('active', isFactual);
  el.faithfulnessBtn?.classList.toggle('active', !isFactual);
  el.factualView?.classList.toggle('active', isFactual);
  el.faithfulnessView?.classList.toggle('active', !isFactual);
}

function clearInput() {
  if (el.textInput)   el.textInput.value = '';
  if (el.promptInput) el.promptInput.value = '';
  el.textInput?.focus();
}

// ══════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════

function toggleTheme() {
  const body = document.body;
  const isLight = body.getAttribute('data-theme') === 'light';
  body.setAttribute('data-theme', isLight ? 'dark' : 'light');
  localStorage.setItem('verityTheme', isLight ? 'dark' : 'light');
  // Update icon tooltip
  if (el.themeToggle) el.themeToggle.title = isLight ? 'Switch to light mode' : 'Switch to dark mode';
}

function loadTheme() {
  const saved = localStorage.getItem('verityTheme');
  if (saved) document.body.setAttribute('data-theme', saved);
}

// ══════════════════════════════════════════════════════════════
// FULLSCREEN WINDOW
// ══════════════════════════════════════════════════════════════

async function openFullscreen() {
  try {
    await saveState();
    const savedId = sessionStorage.getItem('verityPopupId');
    if (savedId) {
      try {
        const w = await chrome.windows.get(parseInt(savedId, 10));
        if (w) { await chrome.windows.update(w.id, { focused: true }); return; }
      } catch { /* closed */ }
    }
    const width  = Math.min(1280, Math.round(screen.availWidth  * 0.85));
    const height = Math.min(900,  Math.round(screen.availHeight * 0.85));
    const left   = Math.round((screen.availWidth  - width)  / 2);
    const top    = Math.round((screen.availHeight - height) / 2);

    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('src/panel/sidepanel.html'),
      type: 'popup', width, height, left, top
    });
    sessionStorage.setItem('verityPopupId', win.id.toString());
  } catch (err) {
    console.error('Fullscreen error:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

async function openSettings() {
  const data = await chrome.storage.local.get(['groqApiKey', 'serpApiKey']);
  if (el.groqApiKeyInput) el.groqApiKeyInput.value = data.groqApiKey || '';
  if (el.serpApiKeyInput) el.serpApiKeyInput.value = data.serpApiKey || '';
  if (el.settingsStatus)  el.settingsStatus.style.display = 'none';
  if (el.settingsModal)   el.settingsModal.style.display  = 'flex';
}

function closeSettings() {
  if (el.settingsModal) el.settingsModal.style.display = 'none';
}

async function saveApiKeys() {
  const groq = (el.groqApiKeyInput?.value || '').trim();
  const serp = (el.serpApiKeyInput?.value || '').trim();

  await chrome.storage.local.set({ groqApiKey: groq, serpApiKey: serp });

  showSettingsStatus('Settings saved — keys stored locally in your browser.', 'success');
  setTimeout(closeSettings, 1200);
}

async function resetKeys() {
  await chrome.storage.local.remove(['groqApiKey', 'serpApiKey']);
  if (el.groqApiKeyInput) el.groqApiKeyInput.value = '';
  if (el.serpApiKeyInput) el.serpApiKeyInput.value = '';
  showSettingsStatus('Keys cleared.', 'success');
}

async function testGroqKey() {
  const key = (el.groqApiKeyInput?.value || '').trim();
  if (!el.testKeyResult) return;

  if (!key) {
    showTestResult('Enter a key above first.', 'fail');
    return;
  }

  showTestResult('Testing connection…', '');
  if (el.testGroqKeyBtn) el.testGroqKeyBtn.disabled = true;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'testApiKey', key });
    if (res?.success) {
      showTestResult('Connected — key is valid.', 'pass');
    } else {
      showTestResult('Authentication failed (401). Check the key.', 'fail');
    }
  } catch (err) {
    showTestResult(err.message, 'fail');
  } finally {
    if (el.testGroqKeyBtn) el.testGroqKeyBtn.disabled = false;
  }
}

function showTestResult(msg, cls) {
  if (!el.testKeyResult) return;
  el.testKeyResult.textContent = msg;
  el.testKeyResult.className   = `test-status ${cls}`;
  el.testKeyResult.style.display = 'inline';
}

function showSettingsStatus(msg, type) {
  if (!el.settingsStatus) return;
  el.settingsStatus.textContent = msg;
  el.settingsStatus.className   = `settings-feedback ${type}`;
  el.settingsStatus.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ══════════════════════════════════════════════════════════════

async function saveState() {
  if (!currentResults) return;
  try {
    await chrome.runtime.sendMessage({
      action: 'saveState',
      state:  { lastResults: currentResults, lastText: currentText, lastPrompt: currentPrompt, lastFaithfulness: faithfulnessResults, timestamp: Date.now() }
    });
  } catch { /* ignore */ }
}

async function restoreState() {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getState' });
    if (r?.success && r.hasState && r.state && Date.now() - r.state.timestamp < 86400000) {
      currentResults       = r.state.lastResults;
      currentText          = r.state.lastText    || '';
      currentPrompt        = r.state.lastPrompt  || '';
      faithfulnessResults  = r.state.lastFaithfulness || null;
      if (currentResults) {
        renderResultsData();
        if (el.navResultsBtn) el.navResultsBtn.style.display = 'inline-flex';
      }
    }
  } catch { /* fresh session */ }
  goToChat();
}

function checkForSelectedText() {
  chrome.storage.local.get(['selectedText', 'timestamp'], (res) => {
    if (res.selectedText && Date.now() - res.timestamp < 300000) {
      if (el.textInput) el.textInput.value = res.selectedText;
      chrome.storage.local.remove(['selectedText', 'timestamp']);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ANALYSIS FLOW
// ══════════════════════════════════════════════════════════════

async function startAnalysis() {
  const text = (el.textInput?.value || '').trim();
  if (!text || text.length < 8) return;

  currentText    = text;
  currentPrompt  = (el.promptInput?.value || '').trim();
  if (el.analyzeBtn) el.analyzeBtn.disabled = true;

  await performAnalysis();
}

async function performAnalysis() {
  showView('loadingSection');
  setProgress(10, 'Splitting claims…');

  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeText', text: currentText, prompt: currentPrompt });

    if (!res?.success) throw new Error(res?.error || 'Analysis failed.');

    currentResults = res.results;

    if (currentPrompt) {
      setProgress(90, 'Checking faithfulness…');
      const fr = await chrome.runtime.sendMessage({ action: 'analyzeFaithfulness', text: currentText, prompt: currentPrompt });
      if (fr?.success) faithfulnessResults = fr.results;
    }

    setProgress(100, 'Complete.');
    await saveState();
    renderResults();

  } catch (err) {
    console.error(err);
    if (err.message.includes('INVALID_API_KEY') || err.message.includes('401')) {
      openSettings();
      showSettingsStatus('Authentication failed (401). Please check your Groq API key — get one at console.groq.com/keys', 'error');
    }
    goToChat();
  } finally {
    if (el.analyzeBtn) el.analyzeBtn.disabled = false;
  }
}

function setProgress(pct, label) {
  if (el.progressBarFill) el.progressBarFill.style.width = `${pct}%`;
  if (el.progressLabel)   el.progressLabel.textContent   = label;
}

// ══════════════════════════════════════════════════════════════
// RENDER RESULTS
// ══════════════════════════════════════════════════════════════

function renderResults() {
  renderResultsData();
  goToResults();
  if (el.navResultsBtn) el.navResultsBtn.style.display = 'inline-flex';
}

function renderResultsData() {
  if (!currentResults) return;

  // Show / hide faithfulness tab
  if (el.faithfulnessBtn) {
    el.faithfulnessBtn.style.display = faithfulnessResults ? 'block' : 'none';
  }

  switchView('factual');
  renderExecutiveSummary();
  renderSentenceBreakdown();
  if (faithfulnessResults) renderFaithfulness();
}

// ── Executive Summary Banner ────────────────────────────────

function renderExecutiveSummary() {
  if (!currentResults) return;

  const sentences = currentResults.sentences || [];
  const exec = currentResults.executiveSummary || buildFallbackExec(sentences);

  const statusMap = {
    VERIFIED:               { cls: 'status-verified',    badge: 'Verified',             label: 'All claims supported' },
    CONTRADICTIONS_DETECTED:{ cls: 'status-refuted',     badge: 'Contradictions Found', label: 'Evidence contradicts claims' },
    MIXED:                  { cls: 'status-mixed',        badge: 'Mixed Results',        label: 'Partially supported' },
    INSUFFICIENT_EVIDENCE:  { cls: 'status-insufficient', badge: 'Insufficient Evidence', label: 'Not enough retrieved sources' },
  };

  const s = statusMap[exec.statusKey] || statusMap.INSUFFICIENT_EVIDENCE;

  const total        = exec.totalClaims        ?? sentences.length;
  const supported    = exec.supportedClaims    ?? 0;
  const refuted      = exec.refutedClaims      ?? 0;
  const insufficient = (exec.unverifiableClaims ?? 0) + (exec.uncertainClaims ?? 0);
  const corroboration = exec.corroborationRate != null ? `${exec.corroborationRate}%` : 'N/A';

  const summaryText = exec.summaryText || s.label;

  const html = `
    <div class="exec-banner ${escapeHtml(s.cls)}">
      <div class="exec-banner-head">
        <div class="exec-status-dot"></div>
        <div class="exec-banner-title">
          <span class="exec-status-label">${escapeHtml(s.badge)}</span>
          <span class="exec-summary-text">${escapeHtml(summaryText)}</span>
        </div>
        <span class="exec-badge">${escapeHtml(s.badge)}</span>
      </div>
      <div class="exec-metrics">
        <div class="exec-metric">
          <span class="exec-metric-val">${escapeHtml(total)}</span>
          <span class="exec-metric-label">Total Claims</span>
        </div>
        <div class="exec-metric">
          <span class="exec-metric-val text-success">${escapeHtml(supported)}</span>
          <span class="exec-metric-label">Supported</span>
        </div>
        <div class="exec-metric">
          <span class="exec-metric-val text-danger">${escapeHtml(refuted)}</span>
          <span class="exec-metric-label">Contradicted</span>
        </div>
        <div class="exec-metric">
          <span class="exec-metric-val text-neutral">${escapeHtml(insufficient)}</span>
          <span class="exec-metric-label">No Evidence</span>
        </div>
        <div class="exec-metric">
          <span class="exec-metric-val">${escapeHtml(corroboration)}</span>
          <span class="exec-metric-label">Corroboration</span>
        </div>
      </div>
    </div>
  `;

  const c = el.executiveSummaryDisplay;
  if (c) c.innerHTML = html;
  if (el.trustScoreDisplay) el.trustScoreDisplay.style.display = 'none';
}

function buildFallbackExec(sentences) {
  const supported     = sentences.filter(s => s.verdict === 'SUPPORTED').length;
  const refuted       = sentences.filter(s => s.verdict === 'REFUTED').length;
  const uncertain     = sentences.filter(s => s.verdict === 'UNCERTAIN').length;
  const unverifiable  = sentences.filter(s => s.verdict === 'UNVERIFIABLE').length;
  const decisive      = supported + refuted;
  const corroboration = decisive > 0 ? Math.round((supported / decisive) * 100) : null;

  let statusKey = 'INSUFFICIENT_EVIDENCE';
  if (refuted > 0 && supported === 0) statusKey = 'CONTRADICTIONS_DETECTED';
  else if (refuted > 0 || uncertain > 0) statusKey = 'MIXED';
  else if (supported === sentences.length && sentences.length > 0) statusKey = 'VERIFIED';

  return {
    statusKey, totalClaims: sentences.length, supportedClaims: supported,
    refutedClaims: refuted, uncertainClaims: uncertain, unverifiableClaims: unverifiable,
    decisiveClaims: decisive, corroborationRate: corroboration
  };
}

// ── Sentence / Claim Cards ──────────────────────────────────

function renderSentenceBreakdown() {
  const sentences = currentResults?.sentences || [];
  const container = el.sentenceBreakdown;
  if (!container) return;

  if (sentences.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:32px 16px;">
        <p style="color:var(--text-tertiary);font-size:13px;">No verifiable claims were extracted.</p>
      </div>`;
    return;
  }

  container.innerHTML = sentences.map((s, i) => buildClaimCard(s, i)).join('');
}

function buildClaimCard(sentence, index) {
  const verdict      = sentence.verdict || 'UNVERIFIABLE';
  const isNA         = sentence.evidenceConfidence === null || sentence.evidenceConfidence === undefined;
  const confDisplay  = isNA ? 'N/A' : `${sentence.evidenceConfidence}%`;
  const supportCount    = sentence.supportCount    ?? sentence.support_count    ?? 0;
  const contradictCount = sentence.contradictCount ?? sentence.contradict_count ?? 0;
  const neutralCount    = sentence.neutralCount    ?? sentence.no_decisive_count ?? sentence.neutral_count ?? 0;
  const allSources      = sentence.allSourcesChecked || sentence.sources || [];
  const sourceCount     = allSources.length;

  const wSupport    = sentence.aggregation?.weightedSupport    ?? sentence.support_signal    ?? 0;
  const wContradict = sentence.aggregation?.weightedContradict ?? sentence.contradict_signal ?? 0;

  const verdictBadgeClass = `verdict-${verdict}`;

  return `
    <div class="claim-card" id="claim-${index}">
      <div class="claim-header">
        <div class="claim-index">${index + 1}</div>
        <div class="claim-body">
          <p class="claim-text">${escapeHtml(sentence.claim)}</p>
          <div class="claim-badges">
            <span class="verdict-badge ${escapeHtml(verdictBadgeClass)}">${escapeHtml(verdict)}</span>
            <span class="conf-badge ${isNA ? 'na' : ''}">
              Evidence: ${escapeHtml(confDisplay)}
            </span>
            <div class="signal-chips">
              <span class="sig-chip support">${supportCount} support</span>
              <span class="sig-chip contradict">${contradictCount} contradict</span>
              <span class="sig-chip neutral">${neutralCount} no signal</span>
            </div>
          </div>
        </div>
      </div>

      ${sentence.explanation ? `
        <div class="claim-explanation">${escapeHtml(sentence.explanation)}</div>
      ` : ''}

      <div class="claim-actions">
        <button class="drawer-toggle" data-drawer-index="${index}" aria-expanded="false">
          <svg viewBox="0 0 12 12" fill="none" class="drawer-chevron-${index}">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Evidence &amp; Scoring (${sourceCount} source${sourceCount !== 1 ? 's' : ''})
        </button>
      </div>

      <!-- Evidence Drawer -->
      <div class="evidence-drawer" id="drawer-${index}">
        <!-- Math box -->
        <div class="math-box">
          <div class="math-box-title">Deterministic Scoring</div>
          <div class="math-stats">
            <div class="math-stat">
              <span class="math-stat-val">${typeof wSupport    === 'number' ? wSupport.toFixed(3)    : wSupport   }</span>
              <span class="math-stat-label">Weighted Support</span>
            </div>
            <div class="math-stat">
              <span class="math-stat-val">${typeof wContradict === 'number' ? wContradict.toFixed(3) : wContradict}</span>
              <span class="math-stat-label">Weighted Contradict</span>
            </div>
            <div class="math-stat">
              <span class="math-stat-val">${escapeHtml(confDisplay)}</span>
              <span class="math-stat-label">Evidence Confidence</span>
            </div>
          </div>
          <div class="math-formula">
            ${isNA
              ? 'Formula: Wt_Support / (Wt_Support + Wt_Contradict) → Undefined (both = 0) → N/A'
              : `Confidence = ${typeof wSupport === 'number' ? wSupport.toFixed(3) : wSupport} / (${typeof wSupport === 'number' ? wSupport.toFixed(3) : wSupport} + ${typeof wContradict === 'number' ? wContradict.toFixed(3) : wContradict}) = ${confDisplay}`
            }
          </div>
        </div>

        <!-- Source citations -->
        <div class="sources-list">
          ${sourceCount > 0
            ? allSources.map((src) => buildSourceCard(src)).join('')
            : '<div class="source-card" style="color:var(--text-tertiary);font-size:11px;">No sources retrieved.</div>'}
        </div>
      </div>
    </div>
  `;
}

function buildSourceCard(source) {
  const nliRel = source.nliRelationship ||
    (source.aiAlignment === 'supports' ? 'SUPPORT'
    : source.aiAlignment === 'contradicts' ? 'CONTRADICT'
    : 'NO_DECISIVE_EVIDENCE');

  const nliLabel = nliRel === 'SUPPORT' ? 'Supports Claim'
    : nliRel === 'CONTRADICT' ? 'Contradicts Claim'
    : 'No Signal';

  const weight       = source.source_weight ?? source.reliability ?? 0.50;
  const relevance    = source.relevance != null ? Math.round(source.relevance * 100) : null;
  const domain       = source.domain || extractDomain(source.url) || source.source || 'source';
  const safeUrl      = sanitizeUrl(source.url);
  const sourceId     = source.source_id || '';
  const snippet      = (source.snippet || source.evidence || '').substring(0, 280);
  const rationale    = source.nliRationale || '';

  // Weight bar fill: weight is 0–1
  const fillPct = Math.round(parseFloat(weight) * 100);

  return `
    <div class="source-card">
      <div class="source-card-head">
        <span class="source-id">${escapeHtml(sourceId)}</span>
        <div class="source-info">
          <div class="source-title">${escapeHtml(source.title || domain)}</div>
          <div class="source-meta">
            <span class="source-domain">${escapeHtml(domain)}</span>
            <span class="nli-badge nli-${escapeHtml(nliRel)}">${escapeHtml(nliLabel)}</span>
          </div>
        </div>
        <div class="source-weight-bar">
          <div class="weight-track"><div class="weight-fill" style="width:${fillPct}%"></div></div>
          <span class="weight-label">w=${escapeHtml(weight)}</span>
        </div>
      </div>

      ${rationale ? `<p class="source-rationale">${escapeHtml(rationale)}</p>` : ''}

      ${snippet ? `
        <blockquote class="source-excerpt">${escapeHtml(snippet)}${(source.snippet || '').length > 280 ? '…' : ''}</blockquote>
      ` : ''}

      ${safeUrl !== '#' ? `
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="source-link">
          View source
          <svg viewBox="0 0 10 10" fill="none"><path d="M2 8L8 2M5 2h3v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>` : ''}
    </div>
  `;
}

function toggleDrawer(index) {
  const drawer  = document.getElementById(`drawer-${index}`);
  const btn     = document.querySelector(`[data-drawer-index="${index}"]`);
  if (!drawer || !btn) return;

  const open = drawer.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');

  // Rotate chevron
  const chevron = drawer.parentElement?.querySelector('.drawer-toggle svg');
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
}

// ── Faithfulness display ────────────────────────────────────

function renderFaithfulness() {
  if (!faithfulnessResults || !el.faithfulnessDisplay) return;
  const f = faithfulnessResults;

  const conclusionClass = f.overallConclusion === 'FAITHFUL'   ? 'pass'
    : f.overallConclusion === 'UNFAITHFUL' ? 'fail' : 'partial';

  const metricRows = f.metrics ? [
    { name: 'Logical Consistency',   key: 'logicalConsistency',   icon: 'L' },
    { name: 'Contextual Alignment',  key: 'contextualAlignment',  icon: 'C' },
    { name: 'Instruction Adherence', key: 'instructionAdherence', icon: 'I' },
  ].map(({ name, key, icon }) => {
    const m = f.metrics[key];
    if (!m) return '';
    const scoreClass = m.score >= 70 ? 'pass' : m.score >= 40 ? 'partial' : 'fail';
    return `
      <div class="faith-metric-row">
        <div class="faith-metric-icon" style="background:var(--bg-raised)">
          <svg viewBox="0 0 14 14" fill="none"><text x="4" y="11" font-size="9" fill="currentColor">${icon}</text></svg>
        </div>
        <div class="faith-metric-body">
          <div class="faith-metric-name">${escapeHtml(name)}</div>
          <div class="faith-metric-text">${escapeHtml(m.analysis || '')}</div>
        </div>
        <span class="faith-score ${scoreClass}">${escapeHtml(m.score)}/100</span>
      </div>`;
  }).join('') : '';

  el.faithfulnessDisplay.innerHTML = `
    <div class="faith-card">
      <div class="faith-header">
        <div class="faith-verdict ${escapeHtml(conclusionClass)}">
          ${escapeHtml((f.overallConclusion || '').replace(/_/g, ' '))}
        </div>
        <div class="faith-summary">${escapeHtml(f.summary || '')}</div>
      </div>
      <div class="faith-metrics">${metricRows}</div>
    </div>

    ${f.detailedExplanation ? `
      <div class="card" style="margin-top:10px;">
        <p style="font-size:11.5px;color:var(--text-secondary);line-height:1.65;">${escapeHtml(f.detailedExplanation)}</p>
      </div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════════════
// EXPORT / PRINT
// ══════════════════════════════════════════════════════════════

function downloadPDF() {
  if (!currentResults) return;
  setTimeout(() => window.print(), 200);
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATION (lightweight toast — no emoji in code)
// ══════════════════════════════════════════════════════════════

function showNotification(msg, type = 'info') {
  const el = document.createElement('div');
  el.textContent  = msg;
  el.style.cssText = `
    position:fixed;bottom:16px;right:16px;z-index:9999;
    background:var(--bg-raised);color:var(--text-primary);
    border:1px solid var(--border);border-radius:var(--r-md);
    padding:10px 14px;font-size:12px;font-family:var(--font-sans);
    box-shadow:var(--shadow-md);max-width:280px;
    animation:fadeIn 200ms ease;
  `;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2800);
}
