const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HeyStockers × MagicBlock — Devnet</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at 50% 40%, #1a1a1a 0%, #0a0a0a 62%, #000 100%);
    color: #fff; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    text-align: center; padding: 24px;
  }
  .wrap { max-width: 620px; }
  .mark { width: 96px; height: 96px; margin: 0 auto 28px; }
  .tag { color: #7c8899; font-size: 13px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; }
  h1 { font-size: 44px; font-weight: 800; letter-spacing: .01em; margin: 14px 0 8px; }
  .rule { width: 56px; height: 3px; background: #fff; opacity: .28; margin: 22px auto; }
  p { color: #aeb6c2; font-size: 17px; line-height: 1.6; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 26px; }
  .chip { border: 1px solid #2a2a2a; border-radius: 999px; padding: 7px 14px; font-size: 12px; font-weight: 700; letter-spacing: .04em; color: #cfd6df; }
  a { color: #fff; }
  .foot { margin-top: 30px; font-size: 12px; color: #667386; }
</style>
</head>
<body>
  <div class="wrap">
    <svg class="mark" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-label="HeyStockers">
      <rect width="1024" height="1024" rx="224" fill="#fff"/>
      <rect x="232" y="184" width="152" height="656" rx="44" fill="#000"/>
      <rect x="640" y="184" width="152" height="656" rx="44" fill="#000"/>
      <path d="M352 604V448L672 284V440L352 604Z" fill="#000"/>
    </svg>
    <div class="tag">Devnet · MagicBlock build</div>
    <h1>HeyStockers × MagicBlock</h1>
    <div class="rule"></div>
    <p>Position Calls are moving on-chain to a MagicBlock <b>Ephemeral Rollup</b> — instant, gasless, real-time reputation you can't fake. Shipping this week for the MagicBlock hackathon.</p>
    <div class="chips">
      <span class="chip">Ephemeral Rollups</span>
      <span class="chip">Gasless signals</span>
      <span class="chip">Sealed calls (Private ER)</span>
      <span class="chip">Solana devnet</span>
    </div>
    <div class="foot">Live product: <a href="https://heystockers.trade">heystockers.trade</a> · This is the devnet hackathon environment.</div>
  </div>
</body>
</html>`;

export default {
  async fetch() {
    return new Response(HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  },
};
