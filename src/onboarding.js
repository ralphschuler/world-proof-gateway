const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export const betaBillingPlan = Object.freeze({
  mode: "configuration_only",
  charging_enabled: false,
  wld_billing_ready: false,
  message: "WLD billing is not enabled in this private beta. No price, receiver, payment collection, or token transfer is configured.",
});

export function onboardingPage({ demoMode }) {
  const badge = demoMode ? "DEMO — no real proof verification or crediting" : "PRIVATE BETA — production verification requires configured World secrets and database";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>World Proof Gateway | Private beta</title>
<style>body{font:16px system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1rem;color:#172033;background:#fafafa}main{background:#fff;padding:2rem;border:1px solid #d9dee8;border-radius:14px}h1{margin-top:0}.badge{display:inline-block;background:#fff3cd;color:#664d03;padding:.35rem .6rem;border-radius:5px;font-weight:700}section{border-top:1px solid #e7eaf0;margin-top:1.5rem;padding-top:1rem}code{background:#f0f2f5;padding:.15rem .3rem;border-radius:3px}input,textarea,button{box-sizing:border-box;width:100%;padding:.65rem;margin:.3rem 0;border:1px solid #b9c1cd;border-radius:5px}button{background:#172033;color:white;border:0;cursor:pointer}small,#result{color:#4b5563}.warning{background:#fff8e1;padding:.75rem;border-radius:6px}</style></head>
<body><main><p class="badge">${escapeHtml(badge)}</p><h1>World Proof Gateway</h1><p>A reviewable private-beta onboarding surface for apps that need a server-side World ID proof boundary.</p>
<section><h2>1. World ID</h2><p>World ID is used to prove a person meets your configured eligibility rule. A live integration requests a signed, project-fixed context and sends the resulting proof to this gateway for server-side verification. This page is a harmless browser demo and does not request a proof.</p></section>
<section><h2>2. Wallet authentication</h2><p>Wallet authentication is separate from World ID. Projects that need an on-chain attestation can bind a proof context to a wallet address; no wallet is connected from this page.</p></section>
<section><h2>3. WLD billing readiness</h2><p id="billing">Loading read-only billing configuration…</p><p class="warning">There is no payment flow in this beta: no MiniKit Pay, no token transfer, no payment-data collection, and no configured price or receiver.</p></section>
<section><h2>4. Your setup link</h2><p>After approval, replace this placeholder with one unique, private onboarding link for the tenant:</p><p><code>https://setup.example.invalid/world-proof/&lt;unique-setup-link&gt;</code></p><small>This is intentionally a placeholder and cannot activate an account.</small></section>
<section><h2>Contact private beta support</h2><p>Requests are retained only in the test/demo memory layer. They are not durable and must not contain secrets, payment data, or proofs.</p><form id="support"><input name="email" type="email" required maxlength="254" placeholder="you@example.com" aria-label="Email"><textarea name="message" required maxlength="2000" placeholder="What do you need help with?" aria-label="Message"></textarea><button>Send demo support request</button></form><p id="result" role="status"></p></section>
</main><script>
fetch('/v1/billing/plan').then(r=>r.json()).then(v=>{document.querySelector('#billing').textContent=v.message||'Billing configuration unavailable.'}).catch(()=>{document.querySelector('#billing').textContent='Billing configuration unavailable.'});
document.querySelector('#support').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch('/v1/support-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),message:f.get('message')})});const v=await r.json();document.querySelector('#result').textContent=v.message||v.error||'Request could not be stored.';});
</script></body></html>`;
}
