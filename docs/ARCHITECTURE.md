# Verity AI — Architectural Specification

Verity AI is an **evidence-first hallucination detection and fact-verification engine** built as a Chrome Extension (Manifest V3).

Unlike legacy AI fact-checkers that prompt large language models to "judge" whether a statement is true or false using internal training weights, Verity AI implements a strict separation between **language comprehension** and **epistemic truth assessment**.

---

## 1. System Pipeline

```
[Input Text]
     │
     ▼
[1. Claim Decomposition] ─── Splits input into atomic verifiable claims
     │
     ▼
[2. Source Retrieval]    ─── Fetches external reference sources (Wikipedia, SerpAPI)
     │
     ▼
[3. NLI Classification]  ─── Evaluates claim ↔ evidence relationship ONLY
     │                       (SUPPORT | CONTRADICT | NO_DECISIVE_EVIDENCE)
     │
     ▼
[4. Deterministic Math]  ─── Calculates signal weights & evidence confidence
     │                       (Zero LLM influence on numbers)
     │
     ▼
[5. Audit Trail]         ─── Generates evidence-bounded explanation & trace
```

---

## 2. Core Epistemic Principles

| Component | Allowed Role | Strictly Forbidden Role |
| :--- | :--- | :--- |
| **LLM (Groq)** | 1. Decompose text into individual statements.<br>2. Natural Language Inference (NLI) between a claim and an explicit retrieved passage.<br>3. Summarize retrieved evidence in natural language. | 1. Deciding if a claim is True/False using memory.<br>2. Generating confidence scores or percentages.<br>3. Adding outside facts not found in retrieved sources. |
| **Deterministic Engine** | 1. Source weight calculation.<br>2. Relevance scoring (keyword overlap).<br>3. Signal weighting.<br>4. Evidence confidence aggregation.<br>5. Final verdict assignment. | 1. Using subjective or heuristic bias.<br>2. Fabricating numbers when evidence is absent (50% fallback). |

---

## 3. Mathematical Formulation

### 3.1 Source Weight System
Every retrieved reference source is mapped to a predefined weight category:

$$\text{Weight}(s) = \begin{cases} 
0.85 & s \in \text{Authoritative / Academic (.gov, .edu, official institutions)} \\
0.75 & s \in \text{Wikipedia (Peer-edited collaborative encyclopedia)} \\
0.50 & s \in \text{General Indexed Web} \\
0.25 & s \in \text{Low Authority / Community UGC (Quora, Reddit, Forums)}
\end{cases}$$

### 3.2 Evidence Signal Calculation
For each evaluated source passage $s$:

$$\text{Relevance}(s) = \frac{|\text{Keywords}(\text{Claim}) \cap \text{Tokens}(\text{Snippet})|}{|\text{Keywords}(\text{Claim})|}$$

$$\text{Signal Weight}(s) = \text{Weight}(s) \times \text{Relevance}(s)$$

### 3.3 Aggregation & Evidence Confidence

The total decisive signal is given by:

$$S_{\text{support}} = \sum_{s \in \text{SUPPORT}} \text{Signal Weight}(s)$$

$$S_{\text{contradict}} = \sum_{s \in \text{CONTRADICT}} \text{Signal Weight}(s)$$

$$\text{Total Decisive Signal} = S_{\text{support}} + S_{\text{contradict}}$$

**Confidence Formula:**

$$\text{Evidence Confidence} = \begin{cases}
\text{null / N/A} & \text{if } S_{\text{support}} = 0 \text{ and } S_{\text{contradict}} = 0 \\
\operatorname{round}\left(\frac{S_{\text{support}}}{S_{\text{support}} + S_{\text{contradict}}} \times 100\right) & \text{otherwise}
\end{cases}$$

### 3.4 Verdict Boundaries

$$\text{Verdict} = \begin{cases}
\text{UNVERIFIABLE} & \text{if Total Decisive Signal } < 0.15 \\
\text{SUPPORTED} & \text{if Evidence Confidence } \ge 65\% \\
\text{REFUTED} & \text{if Evidence Confidence } \le 35\% \\
\text{UNCERTAIN} & \text{if } 35\% < \text{Evidence Confidence} < 65\%
\end{cases}$$

---

## 4. Semantic Mutual-Exclusion in NLI

When evaluating numerical quantities or singular superlatives (e.g., "The highest mountain is X" vs "The highest mountain is Y"):
- The NLI prompt enforces **mutual exclusion rules**: if evidence states fact $Y$ which logically excludes fact $X$, the relationship is classified as `CONTRADICT`, **never** `NO_DECISIVE_EVIDENCE`.
- Non-decisive evidence does not penalize claims: if a claim has 1 supporting source and 2 non-decisive sources, confidence remains 100% (not diluted).
