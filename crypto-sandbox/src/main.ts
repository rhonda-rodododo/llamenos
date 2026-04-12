// Tier 4 PR-A scaffold — PR-B replaces this with the hardened postMessage RPC.
window.parent.postMessage({ kind: 'ready' }, '*')
