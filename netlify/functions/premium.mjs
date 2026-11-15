// ONEGO Premium: server-side Stripe verification. Do not put secret keys in GitHub.
// This MVP uses a Checkout Session ID as a bearer credential until sign-in is added.
const env = (name) => globalThis.Netlify?.env?.get?.(name) || process.env[name] || '';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});
const configured = () => /^sk_(test|live)_[A-Za-z0-9]+$/.test(env('STRIPE_SECRET_KEY')) &&
  /^price_[A-Za-z0-9]+$/.test(env('ONEGO_STRIPE_PRICE_ID'));
const validId = (value) => typeof value === 'string' &&
  /^cs_(test_|live_)[A-Za-z0-9]{12,250}$/.test(value);
const short = (value, max = 200) => String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g,'').trim().slice(0,max);
async function stripeGet(path) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    headers: { authorization: 'Bearer ' + env('STRIPE_SECRET_KEY') },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) {
    console.error('Stripe verification request failed, HTTP', response.status);
    throw new Error('Stripe-Verifizierung ist zurzeit nicht erreichbar.');
  }
  return response.json();
}
async function isPaidSubscription(sessionId) {
  const session = await stripeGet('checkout/sessions/' + encodeURIComponent(sessionId));
  if (session.mode !== 'subscription' || session.status !== 'complete' ||
      session.payment_status !== 'paid' || !session.subscription) return false;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  if (!/^sub_[A-Za-z0-9]+$/.test(subId || '')) return false;
  const sub = await stripeGet('subscriptions/' + encodeURIComponent(subId));
  if (sub.status !== 'active' || sub.id !== subId) return false;
  return Array.isArray(sub.items?.data) && sub.items.data.some(item => {
    const price = item.price || {};
    return price.id === env('ONEGO_STRIPE_PRICE_ID') &&
      price.currency === 'eur' && price.unit_amount === 499 &&
      price.type === 'recurring' && price.recurring?.interval === 'month' &&
      (item.quantity || 1) >= 1;
  });
}
function bewerbung(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Bitte Angaben eingeben.');
  const name=short(input.name,100), job=short(input.job,120), company=short(input.company,120);
  const exp=short(input.experience,600), skills=short(input.skills,200), available=short(input.availability,100);
  const style=short(input.style,20);
  if (!name || !job) throw new Error('Name und Stelle sind erforderlich.');
  const greeting=company ? 'Sehr geehrtes Team von ' + company + ',' : 'Sehr geehrte Damen und Herren,';
  let opening,ending;
  if(style==='kurz') {
    opening='ich bewerbe mich als ' + job + '.';
    ending='Über ein persönliches Gespräch freue ich mich.';
  } else if(style==='klassisch') {
    opening='hiermit bewerbe ich mich um die Position als ' + job + '.';
    ending='Gerne überzeuge ich Sie in einem persönlichen Gespräch von meiner Motivation.';
  } else {
    opening='mit Interesse bewerbe ich mich für die Stelle als ' + job + '.';
    ending='Ich freue mich über die Gelegenheit, Sie persönlich kennenzulernen.';
  }
  const lines=['Bewerbung als ' + job, '', greeting, '', opening];
  if(exp) lines.push('', 'Meine Berufserfahrung: ' + exp);
  if(skills) lines.push('', 'Zu meinen Stärken gehören: ' + skills);
  if(available) lines.push('', 'Meine Verfügbarkeit: ' + available);
  lines.push('',ending,'','Mit freundlichen Grüßen',name);
  return lines.join('\n');
}
function csvCell(value) {
  let s=short(value,240).replace(/^\s+/,'');
  // Prevent spreadsheet formula execution from user-provided text.
  if (/^[=+\-@\t\r]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function csv(records) {
  if(!Array.isArray(records) || records.length>500) throw new Error('Zu viele Budgeteinträge.');
  const rows=['Datum;Art;Beschreibung;Betrag (EUR)'];
  for(const record of records){
    if(!record || typeof record!=='object')continue;
    const amount=Number(record.amount);
    if(!Number.isFinite(amount) || amount<0 || amount>1e9)continue;
    rows.push([csvCell(record.date),csvCell(record.type==='income'?'Einnahme':'Ausgabe'),
      csvCell(record.note),csvCell(amount.toFixed(2).replace('.',','))].join(';'));
  }
  return {filename:'ONEGO-Budget.csv',mime:'text/csv;charset=utf-8',
    content:'\ufeff'+rows.join('\r\n')+'\r\n'};
}
function icsText(value) {return short(value,160).replace(/\\/g,'\\\\').replace(/\n/g,'\\n')
  .replace(/;/g,'\\;').replace(/,/g,'\\,');}
function ics(records) {
  if(!Array.isArray(records) || records.length>300) throw new Error('Zu viele Fristen.');
  const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const out=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ONEGO//Fristen//DE','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  let count=0;
  for(const record of records){
    if(!record || typeof record!=='object' || record.done)continue;
    const date=String(record.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const parsed=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==date)continue;
    const next=new Date(parsed+86400000).toISOString().slice(0,10);
    const title=icsText(record.name||'Frist');
    const stable=short(record.id||String(count),60).replace(/[^A-Za-z0-9_-]/g,'');
    out.push('BEGIN:VEVENT','UID:onego-'+stable+'-'+date.replace(/-/g,'')+'@onego.local',
      'DTSTAMP:'+now,'DTSTART;VALUE=DATE:'+date.replace(/-/g,''),
      'DTEND;VALUE=DATE:'+next.replace(/-/g,''),'SUMMARY:'+title,'END:VEVENT');
    count++;
  }
  out.push('END:VCALENDAR');
  return {filename:'ONEGO-Fristen.ics',mime:'text/calendar;charset=utf-8',content:out.join('\r\n')+'\r\n'};
}
export default async function handler(request) {
  if (request.method !== 'POST') return json({error:'Methode nicht erlaubt'},405);
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)return json({error:'Zugriff nicht erlaubt'},403);
  let body;
  try {
    const raw=await request.text();
    if(raw.length>100000)return json({error:'Anfrage zu groß'},413);
    body=JSON.parse(raw);
  } catch {return json({error:'Ungültige Anfrage'},400);}
  if(!body || typeof body!=='object' || Array.isArray(body))return json({error:'Ungültige Anfrage'},400);
  if(body.action==='ready')return json({ready:configured()});
  if(!configured())return json({error:'Premium ist noch nicht eingerichtet'},503);
  if(!validId(body.sessionId))return json({active:false,error:'Ungültige Sitzungs-ID'},401);
  try {
    const active=await isPaidSubscription(body.sessionId);
    if(body.action==='status')return json({active});
    if(!active)return json({error:'Mitgliedschaft nicht aktiv'},403);
    if(body.action==='bewerbung')return json({result:bewerbung(body.input)});
    if(body.action==='budget_csv')return json(csv(body.records));
    if(body.action==='fristen_ics')return json(ics(body.records));
    return json({error:'Aktion nicht gefunden'},400);
  } catch (error) {
    if(['Name und Stelle sind erforderlich.','Bitte Angaben eingeben.',
        'Zu viele Budgeteinträge.','Zu viele Fristen.'].includes(error.message))
      return json({error:error.message},400);
    console.error('Premium API operation failed:',error.name);
    return json({error:'Premium-Verifizierung ist momentan nicht möglich'},503);
  }
}
