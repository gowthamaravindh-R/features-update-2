# Verity AI — Security & Privacy Architecture

This document describes the security model, secrets management, and data handling practices of Verity AI.

---

## 1. Secrets Management (Zero Hardcoded Secrets)

- **Client-Side Sandbox**: All API credentials (such as Groq API keys and SerpAPI keys) are entered exclusively by the user via the in-app Settings modal.
- **Isolated Storage**: Keys are saved to the browser's `chrome.storage.local` store, which is sandboxed per-extension by Chromium. Keys are never saved to plain text configuration files, disk logs, or version control.
- **No Third-Party Analytics / Exfiltration**: Verity AI does not use telemetry, tracking SDKs, or intermediary proxy servers. API requests are dispatched directly from the browser service worker to:
  - `https://api.groq.com/` (LLM inference)
  - `https://serpapi.com/` (Web search)
  - `https://en.wikipedia.org/` (Public encyclopedia API)

---

## 2. Content Security Policy (CSP)

Manifest V3 strictly controls script execution:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

- **No Remote Code Execution**: No `eval()`, `new Function()`, or remotely hosted scripts (`https://.../script.js`) are permitted or used.
- **Self-Contained Bundles**: All logic is bundled directly within the extension package.

---

## 3. Git Security Checklist for Contributors

Before pushing code to Git or creating a pull request:
1. Ensure `.gitignore` is not bypassed using `git add -f`.
2. Verify no personal keys are written in tests, comments, or documentation.
3. Use `.env.example` as reference; never create `.env` in repository commits.
4. Run automated secret scans if available (`git diff` inspection).
