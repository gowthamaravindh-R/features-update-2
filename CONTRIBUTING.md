# Contributing to Verity AI

Thank you for your interest in contributing to Verity AI! As an evidence-first fact-checking and hallucination detection system, maintaining mathematical rigor, traceability, and architectural integrity is paramount.

---

## Core Development Principles

1. **Evidence-First Architecture**: 
   The system must never use an LLM's parametric memory to decide factual truth. LLMs are restricted strictly to NLI relationship classification (claim ↔ evidence snippet) and constrained summarization.
2. **Zero Fabricated Metrics**:
   Every percentage, score, token metric, or confidence score displayed must either be deterministically calculated by algorithms or directly quoted from an authenticated source. Never invent fallback numbers (e.g. 50% for absence of evidence).
3. **Deterministic Math**:
   Scoring logic must remain deterministic. Test cases must validate pure support, pure contradiction, zero decisive evidence (N/A), non-decisive noise immunity, and mixed signal formulas.
4. **Security & Secrets**:
   Never commit API keys or sensitive credentials. All keys must remain in the client browser sandbox (`chrome.storage.local`).

---

## Repository Structure

```
├── manifest.json              # Chrome Manifest V3 configuration
├── src/
│   ├── background/
│   │   └── background.js      # Service Worker: orchestration, retrieval, NLI & math
│   └── panel/
│       ├── sidepanel.html     # Semantic, accessible UI layout
│       ├── sidepanel.css      # Design system & tokens (Linear/Vercel inspired)
│       └── sidepanel.js       # Client sidepanel controller & state management
├── tests/
│   └── test_verification_logic.py # Automated test suite for verification formulas
├── docs/
│   ├── ARCHITECTURE.md        # Technical architecture & mathematical specifications
│   └── SECURITY.md            # Threat model, secrets handling & CSP
└── assets/
    └── icons/                 # Extension brand icons (16px, 48px, 128px)
```

---

## Local Setup & Development

1. **Prerequisites**:
   - Google Chrome or any Chromium-based browser (Edge, Brave).
   - Python 3.10+ (for running validation tests).

2. **Loading Extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** toggle in the top right.
   - Click **Load unpacked** and select the root directory of this repository.
   - Click on the extension icon or open side panel from any tab.

3. **Running the Test Suite**:
   ```bash
   python tests/test_verification_logic.py
   ```
   All 8 core mathematical verification test cases must pass before submitting any pull request.

---

## Submitting Pull Requests

1. Fork the repository and create your feature branch: `git checkout -b feature/my-feature`.
2. Commit your changes: `git commit -m "feat: enhance NLI prompt constraint"`.
3. Ensure all tests pass.
4. Push to your branch and open a Pull Request with a clear description of changes.
