const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// Shared by the Try-it page and the stored-call view so the two never drift.
const BASE_STYLE = `<style>
  :root {
    --bg: #faf9f7; --panel: #fff; --ink: #1c1b19; --muted: #6b6862;
    --line: #e4e1db; --accent: #9a4f2b; --warn: #a8481b; --ok: #3d6b45;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171614; --panel: #201f1c; --ink: #f0eee9; --muted: #9c988f;
      --line: #32302c; --accent: #d98a5f; --warn: #e0925f; --ok: #7fae86;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 28px; font-size: 0.93rem; }
  /* label is inline by default; with block children the browser fragments it
     and the dashed border collapses into a sliver. */
  .drop { display: block; width: 100%; border: 1.5px dashed var(--line); border-radius: 12px;
    background: var(--panel); padding: 32px 20px; text-align: center; cursor: pointer;
    transition: border-color .15s, background .15s; }
  .drop:hover { border-color: var(--accent); }
  .drop.over { border-color: var(--accent); background: var(--bg); }
  .drop input { display: none; }
  .drop .hint { color: var(--muted); font-size: 0.87rem; margin-top: 6px; }
  .row { display: flex; gap: 10px; align-items: center; justify-content: center;
    margin-top: 16px; flex-wrap: wrap; }
  select, button { font: inherit; padding: 9px 14px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); }
  button { background: var(--accent); color: #fff; border: none; cursor: pointer; font-weight: 600; }
  button:disabled { opacity: .55; cursor: default; }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line);
    font-weight: 500; }
  button.ghost:hover { color: var(--ink); border-color: var(--accent); }
  .modehint { color: var(--muted); font-size: 0.86rem; text-align: center;
    margin: 12px auto 0; max-width: 60ch; }
  .status { margin-top: 18px; color: var(--muted); font-size: 0.9rem; min-height: 1.4em; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 20px 22px; margin-top: 18px; }
  .firstline { font-size: 1.16rem; line-height: 1.45; border-left: 3px solid var(--accent);
    padding-left: 14px; margin: 0; }
  .label { text-transform: uppercase; letter-spacing: .08em; font-size: 0.7rem;
    color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  .badges { display: flex; gap: 7px; flex-wrap: wrap; }
  .badge { font-size: 0.78rem; padding: 3px 9px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted); }
  .badge.risk { border-color: var(--warn); color: var(--warn); }
  ul { margin: 0; padding-left: 20px; }
  li { margin-bottom: 5px; }
  .when { color: var(--warn); font-weight: 600; }
  .meta { color: var(--muted); font-size: 0.82rem; margin-top: 14px; }
  .invalid { border-color: var(--warn); }
  details { margin-top: 14px; } summary { cursor: pointer; color: var(--muted); font-size: 0.88rem; }
  pre { white-space: pre-wrap; font-size: 0.85rem; color: var(--muted);
    background: var(--bg); padding: 12px; border-radius: 8px; overflow-x: auto; }
</style>`;

export function renderTryItPage({ tenant }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transfer Brief — ${escapeHtml(tenant.name)}</title>
${BASE_STYLE}
</head>
<body>
<div class="wrap">
  <h1>Transfer Brief</h1>
  <p class="sub">${escapeHtml(tenant.name)} · upload a call recording and see what the receiving agent would get before they pick up.</p>

  <label class="drop" id="drop">
    <input type="file" id="file" accept="audio/*">
    <div id="filename"><strong>Choose a recording</strong> or drop one here</div>
    <div class="hint">wav, mp3, m4a, ogg, flac · up to 25 MB</div>
  </label>

  <div class="row">
    <select id="mode">
      <option value="transfer">transfer — agent to agent</option>
      <option value="intake">intake — caller to agent</option>
      <option value="try-it">try-it — no assumption</option>
    </select>
    <button id="go" disabled>Build the brief</button>
    <button id="sample" class="ghost" type="button">Use the sample call</button>
  </div>
  <p class="modehint" id="modehint"></p>

  <div class="status" id="status"></div>
  <div id="out"></div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const drop = $('drop'), fileInput = $('file'), go = $('go'), status = $('status'), out = $('out');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

fileInput.addEventListener('change', () => pick(fileInput.files[0]));
['dragover','dragenter'].forEach(e => drop.addEventListener(e, ev => {
  ev.preventDefault(); drop.classList.add('over');
}));
['dragleave','drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', ev => { ev.preventDefault(); pick(ev.dataTransfer.files[0]); });

// Mode changes how the transcript is framed for the model, so say what each
// one assumes rather than leaving the selector looking inert.
const MODE_HINT = {
  transfer: 'Assumes an agent was already on the call. "Already tried" and "Promised" are read as what that first agent did and committed to.',
  intake: 'Assumes the caller is describing the problem on their own, with no agent yet. "Already tried" is read as what the caller has attempted.',
  'try-it': 'Makes no assumption about who is on the call. Use this when the recording is neither a handover nor a clean intake.',
};
const modeSel = $('mode'), modehint = $('modehint');
const showHint = () => { modehint.textContent = MODE_HINT[modeSel.value]; };
modeSel.addEventListener('change', showHint);
showHint();

$('sample').addEventListener('click', async () => {
  const btn = $('sample');
  btn.disabled = true;
  status.textContent = 'Loading the sample recording…';
  try {
    const res = await fetch('/samples/wifi-call.m4a');
    if (!res.ok) throw new Error('sample unavailable (' + res.status + ')');
    const blob = await res.blob();
    pick(new File([blob], 'wifi-call.m4a', { type: 'audio/mp4' }));
    status.textContent = 'Sample loaded — a caller reporting a wifi problem. Press Build the brief.';
  } catch (err) {
    status.textContent = 'Could not load the sample: ' + err.message;
  }
  btn.disabled = false;
});

let chosen = null;
function pick(f) {
  if (!f) return;
  chosen = f;
  $('filename').innerHTML = '<strong>' + esc(f.name) + '</strong> · ' + (f.size/1048576).toFixed(1) + ' MB';
  go.disabled = false;
}

go.addEventListener('click', async () => {
  if (!chosen) return;
  go.disabled = true; out.innerHTML = '';
  status.textContent = 'Transcribing and writing the brief — this takes about 8 seconds…';
  const body = new FormData();
  body.append('mode', $('mode').value);
  body.append('audio', chosen);
  try {
    const res = await fetch('/api/briefs', { method: 'POST', body, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({ error: 'unreadable response' }));
    if (!res.ok) { status.textContent = 'Failed (' + res.status + '): ' + (json.error || ''); }
    else { status.textContent = ''; render(json); }
  } catch (err) {
    status.textContent = 'Request failed: ' + err.message;
  }
  go.disabled = false;
});

function render(r) {
  const b = r.brief, t = r.timings || {};
  const list = (items, empty) => items && items.length
    ? '<ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>'
    : '<p class="sub" style="margin:0">' + empty + '</p>';

  out.innerHTML = [
    '<div class="card' + (r.valid ? '' : ' invalid') + '">',
      '<p class="label">Say this first</p>',
      '<p class="firstline">' + esc(b.first_line) + '</p>',
    '</div>',
    '<div class="card">',
      '<p class="label">Why they are calling</p>',
      '<p style="margin:0 0 16px">' + esc(b.reason) + '</p>',
      '<div class="badges">',
        '<span class="badge">' + esc(b.sentiment.label) + ' · ' +
          Math.round(b.sentiment.confidence * 100) + '%</span>',
        (b.risk_flags || []).filter(f => f !== 'none')
          .map(f => '<span class="badge risk">' + esc(f.replace(/_/g,' ')) + '</span>').join(''),
        '<span class="badge">confidence ' + Math.round(b.confidence * 100) + '%</span>',
      '</div>',
    '</div>',
    '<div class="card">',
      '<p class="label">Already tried</p>',
      list((b.already_tried || []).map(esc), 'Nothing recorded on the call.'),
    '</div>',
    '<div class="card">',
      '<p class="label">Promised</p>',
      list((b.promises || []).map(p =>
        esc(p.what) + (p.by_when ? ' <span class="when">— ' + esc(p.by_when) + '</span>' : '')),
        'No commitments were made.'),
    '</div>',
    '<div class="card">',
      '<p class="label">Still unknown</p>',
      list((b.unknowns || []).map(esc), 'Nothing outstanding.'),
      '<details><summary>Transcript and run details</summary>',
        '<pre>' + esc(r.transcript?.text || '') + '</pre>',
        '<p class="meta">valid=' + r.valid + ' · attempts=' + r.attempts +
          ' · stt=' + t.sttMs + 'ms · brief=' + t.briefMs + 'ms · total=' + t.totalMs + 'ms' +
          (r.warnings && r.warnings.length ? '<br>retry: ' + esc(r.warnings.join('; ')) : '') +
          (r.error ? '<br>error: ' + esc(r.error) : '') + '</p>',
      '</details>',
    '</div>',
  ].join('');
}
</script>
</body>
</html>`;
}

/** Server-rendered view of a stored call — what an agent opens mid-transfer. */
export function renderCallPage({ tenant, call, transcript, brief }) {
  const b = brief?.brief;
  const list = (items, empty) =>
    items?.length
      ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
      : `<p class="sub" style="margin:0">${empty}</p>`;

  const body = !b
    ? '<div class="card"><p class="label">No brief yet</p><p style="margin:0">This call has no brief — it may still be running, or the transcript was empty.</p></div>'
    : [
        `<div class="card${brief.valid ? '' : ' invalid'}">`,
        '<p class="label">Say this first</p>',
        `<p class="firstline">${escapeHtml(b.first_line)}</p>`,
        '</div>',
        '<div class="card">',
        '<p class="label">Why they are calling</p>',
        `<p style="margin:0 0 16px">${escapeHtml(b.reason)}</p>`,
        '<div class="badges">',
        `<span class="badge">${escapeHtml(b.sentiment.label)} · ${Math.round(b.sentiment.confidence * 100)}%</span>`,
        (b.risk_flags || [])
          .filter((f) => f !== 'none')
          .map((f) => `<span class="badge risk">${escapeHtml(f.replace(/_/g, ' '))}</span>`)
          .join(''),
        `<span class="badge">confidence ${Math.round(b.confidence * 100)}%</span>`,
        '</div></div>',
        '<div class="card"><p class="label">Already tried</p>',
        list((b.already_tried || []).map(escapeHtml), 'Nothing recorded on the call.'),
        '</div>',
        '<div class="card"><p class="label">Promised</p>',
        list(
          (b.promises || []).map(
            (p) =>
              escapeHtml(p.what) +
              (p.by_when ? ` <span class="when">— ${escapeHtml(p.by_when)}</span>` : ''),
          ),
          'No commitments were made.',
        ),
        '</div>',
        '<div class="card"><p class="label">Still unknown</p>',
        list((b.unknowns || []).map(escapeHtml), 'Nothing outstanding.'),
        `<details><summary>Transcript and run details</summary><pre>${escapeHtml(transcript?.text || '(no transcript)')}</pre>`,
        `<p class="meta">valid=${brief.valid} · attempts=${brief.attempts ?? '—'} · brief=${brief.latency_ms ?? '—'}ms · model=${escapeHtml(brief.model || '—')}${brief.error ? `<br>error: ${escapeHtml(brief.error)}` : ''}</p></details>`,
        '</div>',
      ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call ${escapeHtml(String(call.id).slice(0, 8))} — ${escapeHtml(tenant.name)}</title>
${BASE_STYLE}</head><body><div class="wrap">
<h1>Transfer Brief</h1>
<p class="sub">${escapeHtml(tenant.name)} · ${escapeHtml(call.mode)} · ${escapeHtml(call.status)} · ${escapeHtml(new Date(call.created_at).toISOString())}</p>
${body}
<p class="meta"><a href="/t/${escapeHtml(tenant.slug)}">← back to Try it</a></p>
</div></body></html>`;
}

export function renderNotFound() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Not found</title>
<style>body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:18vh auto;
padding:0 20px;color:#1c1b19}@media(prefers-color-scheme:dark){body{background:#171614;color:#f0eee9}}</style>
</head><body><h1>No such call</h1>
<p>This call does not exist, or it belongs to a different tenant.</p></body></html>`;
}

export function renderUnauthorized() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Link required</title>
<style>body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:18vh auto;
padding:0 20px;color:#1c1b19}@media(prefers-color-scheme:dark){body{background:#171614;color:#f0eee9}}
code{background:#8883;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>This link is missing its token</h1>
<p>Open the full share link you were given — it looks like <code>/t/&lt;slug&gt;/&lt;token&gt;</code>.
The token is the whole credential; the page stores it in a cookie on first load.</p></body></html>`;
}
