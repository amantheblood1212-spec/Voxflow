/* VoxFlow AI server. Node 18+, nothing to install. Run: node server.js
   Optional settings: PORT, DB_FILE. Put it behind https when it is public. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const DBF = process.env.DB_FILE || path.join(__dirname, 'data.json'), PORT = process.env.PORT || 3000;
const db = Object.assign({ users: {}, sessions: {}, data: {}, dnc: [], live: {}, cfg: {}, runs: {}, used: {}, fails: {} },
  fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : {});
const save = () => fs.writeFileSync(DBF, JSON.stringify(db));
const rid = () => crypto.randomBytes(8).toString('hex');
const l10 = p => String(p || '').replace(/\D/g, '').slice(-10);
const e164 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : null; };
const today = () => new Date().toLocaleDateString('en-CA');
const PRICE = { Basic: 1000, Professional: 1500, Premium: 2000 };
const MISS = /did-not-answer|busy|failed|error|no-answer|voicemail|timeout/i;
const TZ = { AL:'America/Chicago',AK:'America/Anchorage',AZ:'America/Phoenix',AR:'America/Chicago',CA:'America/Los_Angeles',CO:'America/Denver',CT:'America/New_York',DE:'America/New_York',DC:'America/New_York',FL:'America/New_York',GA:'America/New_York',HI:'Pacific/Honolulu',ID:'America/Denver',IL:'America/Chicago',IN:'America/New_York',IA:'America/Chicago',KS:'America/Chicago',KY:'America/New_York',LA:'America/Chicago',ME:'America/New_York',MD:'America/New_York',MA:'America/New_York',MI:'America/New_York',MN:'America/Chicago',MS:'America/Chicago',MO:'America/Chicago',MT:'America/Denver',NE:'America/Chicago',NV:'America/Los_Angeles',NH:'America/New_York',NJ:'America/New_York',NM:'America/Denver',NY:'America/New_York',NC:'America/New_York',ND:'America/Chicago',OH:'America/New_York',OK:'America/Chicago',OR:'America/Los_Angeles',PA:'America/New_York',RI:'America/New_York',SC:'America/New_York',SD:'America/Chicago',TN:'America/Chicago',TX:'America/Chicago',UT:'America/Denver',VT:'America/New_York',VA:'America/New_York',WA:'America/Los_Angeles',WV:'America/New_York',WI:'America/Chicago',WY:'America/Denver' };
// One time zone per state (states that span two zones use one of them). Calls only run 9am-5pm Mon-Fri, well inside the legal 8am-9pm window.
const leadTz = l => { const st = String(l.state || '').toUpperCase() || ((String(l.location || '').match(/,\s*([A-Za-z]{2})\b\s*\d{0,5}\s*$/) || [])[1] || '').toUpperCase(); return TZ[st] || null; };
function hoursOk(tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  const h = +p.find(x => x.type === 'hour').value, w = p.find(x => x.type === 'weekday').value;
  return !['Sat', 'Sun'].includes(w) && h >= 9 && h < 17;
}
const GREETING = 'Hi, this is Alex Carter calling on behalf of a web-design service. Am I speaking with the owner or manager?';
const PROMPT = `You are Alex Carter, a professional solo sales rep phoning a US business owner on behalf of a web-design service. Sound natural, friendly, concise and respectful, never pushy. Ask one question at a time and listen.
Honesty: if asked whether you are AI, say "Yes, I'm an AI voice agent calling on behalf of a web-design service." If asked who you represent, say "My name is Alex Carter, and I'm calling on behalf of a web-design service." Never make false claims.
Flow: confirm you are speaking with the owner or manager. Then: "Perfect, I'll keep it quick. I came across your business and wanted to ask you something about your website. Do you have about 30 seconds?" Then: "Awesome, thank you. I was just wondering, are you currently happy with your website, or have you been thinking about getting it updated?"
No website: "Got it. That's actually why I called. We help businesses get professional websites that make it easier for potential customers to learn about the business and get in touch. Would you be open to hearing a little more?"
Has website: "Nice. What do you like most about your current website, and is there anything you'd want to improve?"
Discovery (use a few, never all in a row): how customers find them now; whether the site represents the business well; what they wish worked better; whether the site brings customers.
If genuinely interested: "Based on what you've told me, it sounds like there could definitely be an opportunity to improve your online presence. Would you like me to explain the website options?"
Packages, fixed prices, no negotiating, no discounts, no custom prices:
Basic $1,000: professional business website, mobile-responsive design, modern layout, business information, contact section, call button, basic SEO setup, social media links.
Professional $1,500: everything in Basic plus more customized design, additional pages, advanced contact/lead form, stronger SEO setup, social media integration, more customization.
Premium $2,000: everything in Professional plus fully customized website, advanced sections/features, premium design, advanced lead/contact features, maximum customization, priority website setup.
Pricing question: "The website options start at $1,000 for the Basic option, $1,500 for Professional, and $2,000 for Premium. The right option depends on what you want the website to do. Which type sounds closer to what your business needs?"
Discount or custom request: "I can note what you're looking for, and the owner can personally discuss a custom option with you." Record it in nextStep.
Interested: confirm the package, then ask "What's the best way for the owner to follow up with you, Instagram or WhatsApp?" Ask for the Instagram username or WhatsApp number. Never ask for passwords, codes or payment details. Never take payment.
Wants time: "Absolutely, I understand. Would it be helpful if I gave you a quick call back on another day?" Get a specific date, time and timezone. Outcome MAYBE if they want to think, CALLBACK if they ask for a specific call time.
Busy: "No worries at all. I completely understand. Would another time be better?"
Not interested: "Totally understand. I appreciate you taking the call. Have a great day." Then end the call.
Asks not to be called again: "Absolutely. I'll make sure you're not contacted again. Have a great day." Outcome DNC, then end the call.
End the call politely when the conversation is finished.`;

const SCHEMA = { type: 'object', required: ['outcome'], properties: {
  outcome: { type: 'string', enum: ['INTERESTED', 'MAYBE', 'NOT_INTERESTED', 'CALLBACK', 'DNC'] },
  package: { type: 'string', enum: ['Basic', 'Professional', 'Premium', ''] },
  contactName: { type: 'string' }, instagram: { type: 'string' }, whatsapp: { type: 'string' },
  followUpDate: { type: 'string', description: 'YYYY-MM-DD' }, followUpTime: { type: 'string', description: 'HH:MM 24h' },
  timezone: { type: 'string' }, nextStep: { type: 'string' } } };

const D = u => db.data[u] || (db.data[u] = { leads: [], calls: [], campaigns: [] });

const DEFPK = {}; for (const n of Object.keys(PRICE)) { const m = PROMPT.match(new RegExp('^' + n + ' \\$[\\d,]+: (.*)$', 'm')); DEFPK[n] = { price: PRICE[n], desc: m ? m[1] : '' }; }
const PK = () => { const o = {}; for (const n in DEFPK) o[n] = Object.assign({}, DEFPK[n], (db.cfg.pk || {})[n]); return o; };
const price = k => (PK()[k] || {}).price;
const money = n => '$' + Number(n).toLocaleString('en-US');
function promptFor() {
  const k = PK(), a = db.cfg.agent || 'Alex Carter'; let t = PROMPT;
  for (const n in k) t = t.replace(new RegExp('^' + n + ' \\$[\\d,]+: .*$', 'm'), () => n + ' ' + money(k[n].price) + ': ' + k[n].desc);
  t = t.replace('The website options start at $1,000 for the Basic option, $1,500 for Professional, and $2,000 for Premium.', () => 'The website options start at ' + money(k.Basic.price) + ' for the Basic option, ' + money(k.Professional.price) + ' for Professional, and ' + money(k.Premium.price) + ' for Premium.');
  return t.split('Alex Carter').join(a);
}
const pw = (p, s) => crypto.scryptSync(String(p), s, 32).toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function addUser(email, p, role) { const id = rid(), s = rid(); db.users[id] = { id, email: String(email).trim().toLowerCase(), salt: s, hash: pw(p, s), role, limit: 500 }; return id; }
const usedToday = u => (db.used[u] && db.used[u].d === today() ? db.used[u] : (db.used[u] = { d: today(), n: 0 }));

// AgentPhone is a second, newer provider. Built from their public SDK docs and an unverified
// REST surface (no access to their full official reference), so treat it as untested until a
// real test call confirms it. Outcome detection asks Alex to state a tagged line at the end of
// the call and parses it from the transcript, since structured-output extraction isn't confirmed
// to exist on this provider the way it does on Vapi.
const AP_TAG = 'END_SUMMARY:';
function apPromptSuffix() {
  return `\nAt the very end of the call, after your goodbye, say exactly one line, spoken naturally as closing paperwork, in this exact format and nothing after it: "${AP_TAG} outcome=<INTERESTED|MAYBE|NOT_INTERESTED|CALLBACK|DNC> package=<Basic|Professional|Premium|none> contact=<name or none> instagram=<username or none> whatsapp=<number or none> followupdate=<YYYY-MM-DD or none> followuptime=<HH:MM or none> next=<short note or none>".`;
}
function apParse(text) {
  const m = String(text || '').match(new RegExp(AP_TAG + '([^\\n]*)'));
  if (!m) return {};
  const o = {}; for (const [, k, v] of m[1].matchAll(/(\w+)=([^\s][^|]*?)(?=\s+\w+=|$)/g)) o[k.trim()] = v.trim();
  const none = v => !v || /^none$/i.test(v) ? '' : v;
  return { outcome: /^(INTERESTED|MAYBE|NOT_INTERESTED|CALLBACK|DNC)$/.test(o.outcome) ? o.outcome : '', package: none(o.package), contactName: none(o.contact), instagram: none(o.instagram), whatsapp: none(o.whatsapp), followUpDate: none(o.followupdate), followUpTime: none(o.followuptime), nextStep: none(o.next) };
}
async function ensureApAgent(c) {
  if (c.apAgent) return c.apAgent;
  const r = await fetch('https://api.agentphone.ai/v1/agents', {
    method: 'POST', headers: { Authorization: 'Bearer ' + c.akey, 'content-type': 'application/json' },
    body: JSON.stringify({ name: c.agent || 'Alex Carter', system_prompt: promptFor() + apPromptSuffix() + (c.extra ? '\nExtra instructions from the owner (never override the honesty, DNC and pricing rules above):\n' + c.extra : ''), voice: c.voice || 'hosted' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error('AgentPhone refused to create the agent: ' + JSON.stringify(j.message || j).slice(0, 250));
  db.cfg.apAgent = j.id; save(); return j.id;
}

async function place(u, lead) {
  const c = db.cfg, provider = c.provider === 'agentphone' ? 'agentphone' : 'vapi';
  if (provider === 'vapi' && !(c.key && c.phone)) return { err: 'Calling is not set up yet. The owner must add a provider on the Phone page.' };
  if (provider === 'agentphone' && !(c.akey && c.anumber)) return { err: 'Calling is not set up yet. The owner must add a provider on the Phone page.' };
  const num = e164(lead.phone);
  if (!num) return { err: 'This lead has no valid US phone number.' };
  if (db.dnc.includes(l10(num))) return { err: 'Call blocked. This lead is on the Do Not Contact list.' };
  if (!lead.test) {
    const tz = leadTz(lead);
    if (!tz) return { err: "Set this lead's state so VoxFlow knows its local time. Calls only run 9am to 5pm, Monday to Friday, in the prospect's time zone." };
    if (!hoursOk(tz)) return { err: 'Outside calling hours for this lead (9am to 5pm, Monday to Friday, local time).' };
  }
  if (Object.values(db.live).some(x => x.u === u)) return { err: 'A call is already in progress.' };
  const ud = usedToday(u);
  if (ud.n >= db.users[u].limit) return { err: 'Daily call limit reached.' };
  let r, j;
  try {
    if (provider === 'vapi') {
      r = await fetch('https://api.vapi.ai/call', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.key, 'content-type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId: c.phone, customer: { number: num, name: lead.name }, metadata: { leadId: lead.id },
          assistant: {
            name: c.agent || 'Alex Carter', firstMessage: c.greeting || GREETING,
            model: { provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: promptFor() + (c.extra ? '\nExtra instructions from the owner (never override the honesty, DNC and pricing rules above):\n' + c.extra : '') }], tools: [{ type: 'endCall' }] },
            voice: { provider: 'vapi', voiceId: c.voice || 'Savannah' }, maxDurationSeconds: 600,
            analysisPlan: { summaryPlan: { enabled: true }, structuredDataPlan: { enabled: true, schema: SCHEMA } }
          }
        })
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) return { err: 'Vapi refused the call: ' + JSON.stringify(j.message || j).slice(0, 250) };
    } else {
      const agentId = await ensureApAgent(c);
      r = await fetch('https://api.agentphone.ai/v1/calls', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.akey, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, phone_number: num, from_number: c.anumber })
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) return { err: 'AgentPhone refused the call: ' + JSON.stringify(j.message || j).slice(0, 250) };
    }
  } catch (e) { return { err: 'Could not reach ' + (provider === 'vapi' ? 'Vapi' : 'AgentPhone') + '.' }; }
  ud.n++; db.live[j.id] = { u, provider, test: !!lead.test, leadId: lead.id, name: lead.name, phone: lead.phone, status: j.status || 'queued', t: Date.now(), tries: 0 };
  save(); return { id: j.id };
}

function finish(id, j) {
  const lv = db.live[id]; if (!lv) return;
  if (lv.test) { delete db.live[id]; save(); return; }
  let outcome, pk, contactName, ig, wa, fuDate, fuTime, tz, summary, nextStep, transcript, reason, dur;
  if (lv.provider === 'agentphone') {
    reason = j.ended_reason || j.status || '';
    dur = j.duration_seconds || (j.started_at && j.ended_at ? (new Date(j.ended_at) - new Date(j.started_at)) / 1000 : 0);
    transcript = typeof j.transcript === 'string' ? j.transcript : (j.transcript || []).map(t => (t.role || t.speaker || '') + ': ' + (t.text || t.message || '')).join('\n');
    const sd = apParse(transcript);
    const missed = MISS.test(reason) || (!sd.outcome && dur < 8);
    outcome = missed ? 'MISSED' : (sd.outcome || 'MAYBE'); pk = price(sd.package) ? sd.package : '';
    contactName = sd.contactName || ''; ig = String(sd.instagram || '').replace('@', ''); wa = sd.whatsapp || '';
    fuDate = sd.followUpDate || ''; fuTime = sd.followUpTime || ''; tz = '';
    summary = (!missed && !sd.outcome ? 'Outcome not detected from the closing summary line. Review the transcript — AgentPhone outcome parsing is unverified.' : '');
    nextStep = sd.nextStep || '';
  } else {
    const an = j.analysis || {}, sd = an.structuredData || {};
    reason = j.endedReason || ''; dur = j.startedAt && j.endedAt ? (new Date(j.endedAt) - new Date(j.startedAt)) / 1000 : 0;
    const missed = MISS.test(reason) || (!sd.outcome && dur < 8);
    outcome = missed ? 'MISSED' : (sd.outcome || 'MAYBE'); pk = price(sd.package) ? sd.package : '';
    contactName = sd.contactName || ''; ig = String(sd.instagram || '').replace('@', ''); wa = sd.whatsapp || '';
    fuDate = sd.followUpDate || ''; fuTime = sd.followUpTime || ''; tz = sd.timezone || '';
    summary = (an.summary || '') + (!missed && !sd.outcome ? ' (Outcome not detected. Review the transcript in Vapi.)' : '');
    nextStep = sd.nextStep || ''; transcript = (j.artifact && j.artifact.transcript) || j.transcript || '';
  }
  D(lv.u).calls.push({
    id, leadId: lv.leadId, name: lv.name, phone: lv.phone, ts: j.startedAt || j.started_at || new Date(lv.t).toISOString(), dur: Math.round(dur / 6) / 10, outcome,
    package: pk, price: pk ? price(pk) : 0, contact: contactName, ig, wa, fuDate, fuTime, tz, summary, next: nextStep, transcript, endedReason: reason, source: 'alex', provider: lv.provider
  });
  if (outcome === 'DNC' && l10(lv.phone) && !db.dnc.includes(l10(lv.phone))) db.dnc.push(l10(lv.phone));
  delete db.live[id]; save();
}

setInterval(async () => {           // follow live calls with the provider
  for (const [id, lv] of Object.entries(db.live)) {
    try {
      const url = lv.provider === 'agentphone' ? 'https://api.agentphone.ai/v1/calls/' + id : 'https://api.vapi.ai/call/' + id;
      const key = lv.provider === 'agentphone' ? db.cfg.akey : db.cfg.key;
      const j = await (await fetch(url, { headers: { Authorization: 'Bearer ' + key } })).json();
      const status = lv.provider === 'agentphone' ? j.status : j.status;
      if (status) lv.status = status;
      const ended = lv.provider === 'agentphone' ? /ended|completed|failed|no.answer|busy/i.test(status || '') : status === 'ended';
      if (ended) {
        lv.tries++;
        if (lv.provider === 'agentphone' && !j.transcript) { try { j.transcript = await (await fetch(url + '/transcript', { headers: { Authorization: 'Bearer ' + key } })).json(); } catch (e) { } }
        if (lv.provider === 'agentphone' ? (lv.tries > 2) : ((j.analysis || {}).structuredData?.outcome || lv.tries > 8 || MISS.test(j.endedReason || ''))) finish(id, j);
      }
      else if (Date.now() - lv.t > 20 * 60000) finish(id, { endedReason: 'timeout' });
    } catch (e) { }
  }
  save();
}, 4000);

function nextLead(u, run) {
  const d = D(u), camp = run.campaign ? d.campaigns.find(c => c.id === run.campaign) : null;
  const last = id => [...d.calls].reverse().find(c => c.leadId === id);
  const all = d.leads.filter(l => e164(l.phone) && !db.dnc.includes(l10(l.phone)) && (!camp || camp.leadIds.includes(l.id)));
  const nowIn = z => { try { return new Date().toLocaleString('sv-SE', { timeZone: z }).slice(0, 16); } catch (e) { return new Date().toISOString().slice(0, 16); } };
  const due = l => { const c = last(l.id); if (!(c && ['MAYBE', 'CALLBACK'].includes(c.outcome) && c.fuDate)) return false; const z = /\//.test(c.tz || '') ? c.tz : leadTz(l); return (c.fuDate + ' ' + (c.fuTime || '09:00')) <= nowIn(z || 'UTC'); };
  const pending = all.filter(l => due(l) || !last(l.id)).sort((a, b) => due(b) - due(a));
  if (!pending.length) return null;
  return pending.find(l => { const z = leadTz(l); return z && hoursOk(z); }) || 'wait';
}
setInterval(async () => {           // START / STOP runner: one call at a time per user
  for (const [u, run] of Object.entries(db.runs)) {
    if (!run.on || Object.values(db.live).some(x => x.u === u)) continue;
    const lead = nextLead(u, run);
    if (lead === 'wait') { run.msg = 'Waiting: outside calling hours, or leads still need a state set.'; save(); continue; }
    if (!lead) { run.on = false; run.msg = 'Finished. No eligible leads left.'; save(); continue; }
    if (!run.on) continue;
    const r = await place(u, lead);
    if (!run.on) { save(); continue; }
    run.msg = r.err ? 'Stopped. ' + r.err : 'Calling ' + lead.name;
    if (r.err) run.on = false;
    save();
  }
}, 6000);

const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); });
const send = (res, c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const cookie = req => ((req.headers.cookie || '').match(/vf=([a-f0-9]+)/) || [])[1];
function session(req, res, id) {
  const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = id; save();
  res.setHeader('Set-Cookie', `vf=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  return send(res, 200, { ok: true });
}

const ri = process.argv.indexOf('--reset-owner');
if (ri > 0) {
  const o = Object.values(db.users).find(x => x.role === 'owner'), np = process.argv[ri + 1];
  if (o && np && np.length >= 8) { o.salt = rid(); o.hash = pw(np, o.salt); db.sessions = {}; save(); console.log('Owner password reset.'); } else console.log('Usage: node server.js --reset-owner NEWPASSWORD (8+ characters)');
  process.exit(0);
}
http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (!p.startsWith('/api/')) {
      const PUB = path.join(__dirname, 'public'), f = path.join(PUB, p === '/' ? 'index.html' : decodeURIComponent(p));
      const file = f.startsWith(PUB + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(PUB, 'index.html');
      const ext = path.extname(file), MIME = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };
      let data = fs.readFileSync(file);
      if (ext === '.html') data = Buffer.from(data.toString().split('%%ORIGIN%%').join(String(req.headers['x-forwarded-proto'] || 'http').split(',')[0] + '://' + req.headers.host));
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
      return res.end(data);
    }
    const b = req.method === 'POST' ? await body(req) : {}, uid = db.sessions[cookie(req)], me = db.users[uid];
    if (p === '/api/me') return send(res, 200, { setup: !Object.keys(db.users).length, me: me ? { email: me.email, role: me.role } : null });
    if (p === '/api/signup') {
      if (Object.keys(db.users).length) return send(res, 403, { error: 'Accounts are created by the owner.' });
      if (String(b.password || '').length < 8 || !b.email) return send(res, 400, { error: 'Enter an email and a password of 8+ characters.' });
      return session(req, res, addUser(b.email, b.password, 'owner'));
    }
    if (p === '/api/login') {
      const ip = req.socket.remoteAddress, f = db.fails[ip] || (db.fails[ip] = { n: 0, t: Date.now() });
      if (Date.now() - f.t > 9e5) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 10) return send(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
      const us = Object.values(db.users).find(x => x.email === String(b.email || '').trim().toLowerCase());
      if (!us || !same(pw(b.password, us.salt), us.hash)) { f.n++; return send(res, 401, { error: 'Wrong email or password.' }); }
      return session(req, res, us.id);
    }
    if (p === '/api/logout') { delete db.sessions[cookie(req)]; save(); res.setHeader('Set-Cookie', 'vf=; Max-Age=0; Path=/'); return send(res, 200, { ok: true }); }
    if (!me) return send(res, 401, { error: 'Sign in required.' });
    if (p === '/api/password') {
      if (!same(pw(b.old, me.salt), me.hash) || String(b.new || '').length < 8) return send(res, 400, { ok: false, error: 'Current password is wrong, or the new one is under 8 characters.' });
      me.salt = rid(); me.hash = pw(b.new, me.salt); save(); return send(res, 200, { ok: true });
    }
    const d = D(uid), own = me.role === 'owner';
    if (p === '/api/state') return send(res, 200, {
      me: { email: me.email, role: me.role }, leads: d.leads, calls: d.calls, campaigns: d.campaigns, dnc: db.dnc,
      live: Object.fromEntries(Object.entries(db.live).filter(([, x]) => x.u === uid)), run: db.runs[uid] || { on: false },
      limit: me.limit, used: usedToday(uid).n, pk: PK(),
      cfg: {
        provider: db.cfg.provider === 'agentphone' ? 'agentphone' : 'vapi',
        ready: db.cfg.provider === 'agentphone' ? !!(db.cfg.akey && db.cfg.anumber) : !!(db.cfg.key && db.cfg.phone),
        hasKey: !!db.cfg.key, phone: own ? db.cfg.phone || '' : '',
        hasAkey: !!db.cfg.akey, anumber: own ? db.cfg.anumber || '' : '',
        greeting: db.cfg.greeting || GREETING, voice: db.cfg.voice || 'Savannah', agent: db.cfg.agent || 'Alex Carter', extra: db.cfg.extra || ''
      }
    });
    if (p === '/api/leads') { if (Array.isArray(b.leads)) { d.leads = b.leads.slice(0, 20000); save(); } return send(res, 200, { ok: true }); }
    if (p === '/api/campaigns') { if (Array.isArray(b.campaigns)) { d.campaigns = b.campaigns.slice(0, 500); save(); } return send(res, 200, { ok: true }); }
    if (p === '/api/calls') {
      const c = b.call || {}; if (!c.id || !c.outcome) return send(res, 400, { ok: false });
      c.source = 'manual'; if (!d.calls.some(x => x.id === c.id)) d.calls.push(c);
      if (c.outcome === 'DNC' && l10(c.phone) && !db.dnc.includes(l10(c.phone))) db.dnc.push(l10(c.phone));
      save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/call') {
      const lead = d.leads.find(x => x.id === b.leadId); if (!lead) return send(res, 404, { ok: false, error: 'Lead not found.' });
      const r = await place(uid, lead); return send(res, r.err ? 400 : 200, r.err ? { ok: false, error: r.err } : { ok: true, callId: r.id });
    }
    if (p === '/api/start') { db.runs[uid] = { on: true, campaign: b.campaign || '', msg: 'Starting…' }; save(); return send(res, 200, { ok: true }); }
    if (p === '/api/stop') { const r = db.runs[uid] || (db.runs[uid] = {}); r.on = false; r.msg = 'Stopped. No new calls will start.'; save(); return send(res, 200, { ok: true }); }
    if (!own) return send(res, 403, { ok: false, error: 'Owner only.' });
    if (p === '/api/cfg') {
      if (b.key) db.cfg.key = String(b.key).trim();
      if (b.akey) { db.cfg.akey = String(b.akey).trim(); delete db.cfg.apAgent; } // new key means the old agent may not belong to it
      if (b.provider === 'vapi' || b.provider === 'agentphone') db.cfg.provider = b.provider;
      for (const k of ['phone', 'anumber', 'greeting', 'voice', 'extra', 'agent']) if (typeof b[k] === 'string') { db.cfg[k] = b[k].trim(); if (k === 'agent' || k === 'voice' || k === 'extra') delete db.cfg.apAgent; }
      save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/prompt') return send(res, 200, { ok: true, prompt: promptFor() });
    if (p === '/api/packages') {
      const o = {}; for (const n in DEFPK) { const x = (b.pk || {})[n] || {}, pr = Math.round(+x.price); if (pr > 0 && pr < 1e6) o[n] = { price: pr, desc: String(x.desc || '').slice(0, 800) }; }
      db.cfg.pk = Object.assign({}, db.cfg.pk, o); save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/test') {
      const ap = db.cfg.provider === 'agentphone';
      if (ap ? !(db.cfg.akey && db.cfg.anumber) : !(db.cfg.key && db.cfg.phone)) return send(res, 200, { ok: false, error: 'Telephony provider not connected. Connect a provider in Phone Settings before making calls.' });
      try {
        if (ap) {
          const r = await fetch('https://api.agentphone.ai/v1/numbers', { headers: { Authorization: 'Bearer ' + db.cfg.akey } }), j = await r.json().catch(() => ({}));
          if (!r.ok) return send(res, 200, { ok: false, error: 'The provider rejected the connection: ' + JSON.stringify(j.message || j).slice(0, 200) });
          const nums = Array.isArray(j) ? j : (j.numbers || j.data || []);
          const match = nums.find(n => e164(n.phone_number || n.number) === e164(db.cfg.anumber));
          return send(res, 200, match ? { ok: true, number: match.phone_number || match.number, status: match.status || '' } : { ok: false, error: 'That number was not found on this AgentPhone account. Check the number on the Phone page matches your AgentPhone dashboard exactly.' });
        }
        const r = await fetch('https://api.vapi.ai/phone-number/' + encodeURIComponent(db.cfg.phone), { headers: { Authorization: 'Bearer ' + db.cfg.key } }), j = await r.json().catch(() => ({}));
        return send(res, 200, r.ok ? { ok: true, number: j.number || j.name || '', status: j.status || '' } : { ok: false, error: 'The provider rejected the connection: ' + JSON.stringify(j.message || j).slice(0, 200) });
      } catch (e) { return send(res, 200, { ok: false, error: 'Could not reach the provider.' }); }
    }
    if (p === '/api/testcall') { const r = await place(uid, { id: 'test', name: 'Test call', phone: b.phone, test: true }); return send(res, r.err ? 400 : 200, r.err ? { ok: false, error: r.err } : { ok: true, callId: r.id }); }
    if (p === '/api/admin') return send(res, 200, {
      dnc: db.dnc.length,
      users: Object.values(db.users).map(x => ({ id: x.id, email: x.email, role: x.role, limit: x.limit, used: usedToday(x.id).n, leads: D(x.id).leads.length, calls: D(x.id).calls.length }))
    });
    if (p === '/api/admin/user') {
      if (b.action === 'create') {
        if (!b.email || String(b.password || '').length < 8) return send(res, 400, { ok: false, error: 'Email and 8+ character password needed.' });
        if (Object.values(db.users).some(x => x.email === String(b.email).trim().toLowerCase())) return send(res, 400, { ok: false, error: 'That email already exists.' });
        addUser(b.email, b.password, 'user');
      }
      const t = db.users[b.id];
      if (t && t.role !== 'owner') {
        if (b.action === 'update' && b.limit >= 0) t.limit = Math.floor(b.limit);
        if (b.action === 'reset' && String(b.password || '').length >= 8) { t.salt = rid(); t.hash = pw(b.password, t.salt); for (const k in db.sessions) if (db.sessions[k] === b.id) delete db.sessions[k]; }
        if (b.action === 'delete') { delete db.users[b.id]; delete db.data[b.id]; delete db.runs[b.id]; for (const k in db.sessions) if (db.sessions[k] === b.id) delete db.sessions[k]; }
      }
      save(); return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false });
  } catch (e) { send(res, 500, { ok: false, error: String(e.message || e) }); }
}).listen(PORT, () => console.log('VoxFlow running on http://localhost:' + PORT));
