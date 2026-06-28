export const UI_PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>ccsync</title>
<style>body{font:14px system-ui;margin:2rem;max-width:40rem}code{background:#eee;padding:.1rem .3rem;border-radius:3px}</style>
</head>
<body>
<h1>ccsync</h1>
<p>Control service is running. The full dashboard ships in Phase 2.</p>
<pre id="state">loading…</pre>
<script>
fetch("/api/state").then(r=>r.json()).then(s=>{
  document.getElementById("state").textContent = JSON.stringify(s, null, 2);
}).catch(e=>{document.getElementById("state").textContent = "error: "+e});
</script>
</body>
</html>`;
