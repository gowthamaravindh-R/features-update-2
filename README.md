<div align="center">

# Verity AI

### Evidence-First Fact Verification & Hallucination Auditing Engine

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Hardcoded Secrets](https://img.shields.io/badge/Security-Zero_Hardcoded_Secrets-10b981.svg)](docs/SECURITY.md)
[![Deterministic Engine](https://img.shields.io/badge/Architecture-Deterministic_NLI-8b5cf6.svg)](docs/ARCHITECTURE.md)
[![Tests Passing](https://img.shields.io/badge/Verification_Tests-8%2F8_Passed-success.svg)](tests/)

<p align="center">
  A production-ready browser extension designed for researchers, analysts, and enterprise knowledge workers to rigorously audit AI-generated content against authenticated, external primary sources.
</p>

</div>

---

## Overview

Most AI fact-checkers commit a fundamental epistemic error: they ask a Large Language Model to "judge" whether a statement is true using its internal parametric weights. This approach frequently hallucinates false confidence scores, invents corroborating details, and lacks mathematical accountability.

**Verity AI** inverts this paradigm through an **Evidence-First Architecture**:

1. **Parametric Decoupling**: The LLM is never allowed to determine truth from memory. It is strictly constrained to syntactic claim decomposition and Natural Language Inference (NLI) relationship classification between a statement and an explicit retrieved passage.
2. **Deterministic Mathematical Scoring**: Confidence scores and verdicts are computed through transparent mathematical formulas using source authority weights and lexical relevance.
3. **Zero Fabricated Fallbacks**: When decisive evidence is absent, the system reports `N/A` (never a fabricated 50% fallback).
4. **Complete Traceability**: Every evaluated claim exposes its mathematical calculation, source weights, relevance ratios, and verbatim excerpts.

---

## System Architecture

```
                  ┌────────────────────────────────────────┐
                  │          Input Statement(s)            │
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │      1. Atomic Claim Extraction        │
                  │   Deconstructs text into propositions  │
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │      2. Multi-Source Retrieval         │
                  │   Wikipedia API + SerpAPI Web Search   │
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │       3. Strict NLI Classification     │
                  │   SUPPORT | CONTRADICT | NO_DECISIVE   │
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │    4. Deterministic Signal Weighting   │
                  │     Confidence = S_sup / (S_sup + S_con)│
                  └──────────────────┬─────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │      5. Evidence-Bound Audit View      │
                  │   Executive banner, math drawer & citations
                  └────────────────────────────────────────┘
```

---

## Core Verification Formulas

$$\text{Signal Weight}(s) = \text{Authority}(s) \times \text{Relevance}(s)$$

$$\text{Evidence Confidence} = \begin{cases}
\text{N/A} & \text{if } \sum W_{\text{support}} = 0 \text{ and } \sum W_{\text{contradict}} = 0 \\
\operatorname{round}\left(\frac{\sum W_{\text{support}}}{\sum W_{\text{support}} + \sum W_{\text{contradict}}} \times 100\right) & \text{otherwise}
\end{cases}$$

### Predefined Source Authority Weights
- **Authoritative / Academic (`.gov`, `.edu`, official)**: `0.85`
- **Peer-Reviewed Reference (Wikipedia)**: `0.75`
- **General Indexed Web**: `0.50`
- **User-Generated Content (Forums, Quora, Reddit)**: `0.25`

---

## Directory Structure

The codebase is organized into modular directories following enterprise Chrome Extension development standards:

```
├── manifest.json              # Chrome Manifest V3 descriptor
├── .gitignore                 # Secrets, OS artifacts & environment ignore list
├── .gitattributes             # Cross-platform line ending normalization
├── .env.example               # Reference environment variables template
├── LICENSE                    # MIT open-source license
├── README.md                  # System overview and deployment guide
├── CONTRIBUTING.md            # Contributor workflows and code standards
├── assets/
│   └── icons/                 # Application icon assets (16px, 48px, 128px)
├── src/
│   ├── background/
│   │   └── background.js      # Ephemeral service worker, NLI engine & math
│   └── panel/
│       ├── sidepanel.html     # Semantic, accessible UI layout
│       ├── sidepanel.css      # Enterprise design tokens (Linear/Vercel aesthetic)
│       └── sidepanel.js       # UI controller, state sync & drawer handlers
├── tests/
│   ├── test_verification_logic.py # Python automated verification test suite
│   └── test_verification_logic.js # JavaScript test suite reference
└── docs/
    ├── ARCHITECTURE.md        # Mathematical specifications & NLI prompt rules
    └── SECURITY.md            # Threat model, secrets sandbox & CSP posture
```

---

## Security & Secrets Management

Verity AI is engineered to be **safe for open-source publication**:

- **Zero Hardcoded Credentials**: Source files contain zero API keys, bearer tokens, or sensitive variables.
- **Client Sandbox (`chrome.storage.local`)**: Keys entered in the Settings modal reside exclusively in the local browser storage partition managed by Chromium.
- **Strict Content Security Policy**: Manifest V3 enforces `script-src 'self'`, prohibiting `eval()` and external script injections.
- **No Third-Party Telemetry**: Requests are sent directly from the client's browser to official provider endpoints (`api.groq.com`, `serpapi.com`, `en.wikipedia.org`).

---

## Getting Started

### 1. Installation
1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/verity-ai.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
3. Toggle on **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the root directory of this repository (the folder containing `manifest.json`).
5. Pin **Verity AI** to your browser toolbar for quick access.

### 2. Configuration
1. Open the Verity AI side panel.
2. Click the **Settings (gear icon)** in the top navigation bar.
3. Configure your API credentials:
   - **Groq API Key** (Required for LLM NLI inference): Get a free key with fast inference at [console.groq.com/keys](https://console.groq.com/keys). Uses `openai/gpt-oss-20b`.
   - **SerpAPI Key** (Optional for live Google search): Get a key at [serpapi.com](https://serpapi.com). If omitted, Wikipedia encyclopedic sources are verified.
4. Click **Test Connection** to validate your key, then click **Save Settings**.

### 3. Usage
- **Direct Input**: Paste any statement or AI response into the text area and click **Run Verification** (or press `Ctrl + Enter`).
- **Web Highlighting**: Highlight any passage on any webpage, right-click, and select **"Check with Verity AI"** to open the side panel and inspect claims automatically.

---

## Automated Test Suite

Verity AI includes an automated deterministic test suite validating all mathematical scenarios:

```bash
# Execute deterministic verification test suite
python tests/test_verification_logic.py
```

### Verified Test Cases
1. `Test 1`: Pure Support yields exactly 100% confidence (no artificial 95% cap).
2. `Test 2`: Pure Contradiction yields 0% confidence with `REFUTED` verdict.
3. `Test 3`: Zero decisive evidence yields `N/A` confidence and `UNVERIFIABLE` verdict (no fabricated 50% fallback).
4. `Test 4`: Non-decisive evidence does not penalize or dilute legitimate support signals.
5. `Test 5`: Deterministic mixed signals strictly evaluate to `Support / (Support + Contradict)`.
6. `Test 6`: Configured source weights map accurately to domain hierarchies.
7. `Test 7`: Executive summary aggregation correctly summarizes document status and corroboration rate.
8. `Test 8`: Mathematical consistency between user-facing formulas and underlying values.

---

## License

This project is licensed under the [MIT License](LICENSE).
