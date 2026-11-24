// Surveillance de tous les sites en ligne DE'KLIK : le site répond, le certificat HTTPS et le nom de domaine
// ne vont pas expirer. Node 20+, aucune dépendance.
//
// Alertes : une « issue » GitHub par site en panne (GitHub t'envoie UN e-mail à l'ouverture, UN à la fermeture),
// fermée automatiquement quand le site va de nouveau bien. Pas d'e-mail à chaque vérification.
//
// Usage local (aucune issue créée) : node verifier.mjs
import tls from 'node:tls';
import { readFile, writeFile } from 'node:fs/promises';

const JOURS_CERTIFICAT = 14;   // alerte si le certificat expire dans moins de 14 jours
const JOURS_DOMAINE = 30;      // alerte si le nom de domaine expire dans moins de 30 jours
const ESSAIS = 3;              // une panne n'est retenue qu'après 3 échecs d'affilée
const PAUSE_ESSAI_MS = 20_000;
const LABEL = 'panne';

const sites = JSON.parse(await readFile(new URL('./sites.json', import.meta.url), 'utf8'));
const jours = (date) => Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function repond(url) {
  let dernier = '';
  for (let i = 1; i <= ESSAIS; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'surveillance-sites (DE\'KLIK)' } });
      if (r.status < 400) return { ok: true, detail: `HTTP ${r.status} en ${((Date.now() - t0) / 1000).toFixed(1)} s` };
      dernier = `HTTP ${r.status}`;
    } catch (e) { dernier = e.name === 'TimeoutError' ? 'aucune réponse en 20 s' : (e.cause?.code || e.message); }
    if (i < ESSAIS) await attendre(PAUSE_ESSAI_MS);
  }
  return { ok: false, detail: `ne répond pas (${dernier}, ${ESSAIS} essais)` };
}

function certificat(hote) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: hote, port: 443, servername: hote, timeout: 15_000 }, () => {
      const c = s.getPeerCertificate(); s.end();
      if (!c?.valid_to) return resolve({ ok: false, detail: 'certificat illisible' });
      const j = jours(c.valid_to);
      resolve({ ok: j >= JOURS_CERTIFICAT, jours: j, detail: `certificat valable encore ${j} jours` });
    });
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, detail: 'certificat : pas de réponse' }); });
    s.on('error', (e) => resolve({ ok: false, detail: `certificat invalide (${e.code || e.message})` }));
  });
}

// Annuaire officiel IANA : quel serveur RDAP répond pour chaque extension (.fr → AFNIC, .com → Verisign…).
let annuaire = null;
async function serveurRdap(nom) {
  annuaire ??= await fetch('https://data.iana.org/rdap/dns.json', { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => ({ services: [] }));
  const ext = nom.split('.').pop().toLowerCase();
  const s = annuaire.services.find(([exts]) => exts.includes(ext));
  return s ? s[1][0].replace(/\/?$/, '/') : null;
}
async function domaine(nom) {
  try {
    const base = await serveurRdap(nom);
    if (!base) return { ok: true, inconnu: true, detail: "date d'expiration du domaine non publiée pour cette extension" };
    const r = await fetch(`${base}domain/${nom}`, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { accept: 'application/rdap+json', 'user-agent': 'surveillance-sites (DE\'KLIK)' } });
    if (!r.ok) return { ok: true, inconnu: true, detail: `date d'expiration du domaine indisponible (RDAP ${r.status})` };
    const j = await r.json();
    const fin = (j.events || []).find((e) => e.eventAction === 'expiration')?.eventDate;
    if (!fin) return { ok: true, inconnu: true, detail: "date d'expiration du domaine non publiée" };
    const n = jours(fin);
    return { ok: n >= JOURS_DOMAINE, jours: n, detail: `domaine valable encore ${n} jours` };
  } catch { return { ok: true, inconnu: true, detail: "date d'expiration du domaine indisponible" }; }
}

const racine = (hote) => hote.replace(/^www\./, '');
const resultats = [];
for (const s of sites) {
  const hote = new URL(s.url).hostname; s.nom ||= hote.replace(/^www\./, '');
  const [site, cert, dom] = await Promise.all([repond(s.url), certificat(hote), domaine(s.domaine || racine(hote))]);
  const problemes = [!site.ok && `Le site ${site.detail}.`, !cert.ok && `Certificat HTTPS : ${cert.detail}.`, !dom.ok && `Nom de domaine : ${dom.detail} — à renouveler chez le registrar.`].filter(Boolean);
  resultats.push({ nom: s.nom, url: s.url, ok: !problemes.length, problemes, site: site.detail, certificat: cert.detail, domaine: dom.detail });
  console.log(`${problemes.length ? '✗' : '✓'} ${s.nom} — ${site.detail} · ${cert.detail} · ${dom.detail}`);
}

// Résumé lisible dans GitHub (onglet Actions) et état du jour (garde le dépôt actif pour GitHub).
const resume = ['| | Site | Réponse | Certificat | Domaine |', '|---|---|---|---|---|',
  ...resultats.map((r) => `| ${r.ok ? '✅' : '❌'} | [${r.nom}](${r.url}) | ${r.site} | ${r.certificat} | ${r.domaine} |`)].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Surveillance des sites\n\n${resume}\n`);
const etat = { jour: new Date().toISOString().slice(0, 10), sites: resultats.map(({ nom, ok, problemes }) => ({ nom, ok, problemes })) };
await writeFile(new URL('./etat.json', import.meta.url), JSON.stringify(etat, null, 2) + '\n');

// Issues GitHub : une par site en panne, fermée quand tout revient. Seulement dans GitHub Actions.
const { GITHUB_TOKEN: jeton, GITHUB_REPOSITORY: depot } = process.env;
if (jeton && depot) {
  const api = (chemin, o = {}) => fetch(`https://api.github.com/repos/${depot}${chemin}`, { ...o, headers: { authorization: `Bearer ${jeton}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' } }).then((r) => r.json());
  const ouvertes = await api(`/issues?state=open&labels=${LABEL}&per_page=100`);
  for (const r of resultats) {
    const titre = `Panne : ${r.nom}`;
    const issue = (Array.isArray(ouvertes) ? ouvertes : []).find((i) => i.title === titre);
    if (!r.ok && !issue) {
      await api('/issues', { method: 'POST', body: JSON.stringify({ title: titre, labels: [LABEL], body: `**${r.nom}** — ${r.url}\n\n${r.problemes.map((p) => `- ${p}`).join('\n')}\n\nCette alerte se fermera toute seule quand le site ira de nouveau bien.` }) });
      console.log(`→ alerte ouverte : ${titre}`);
    } else if (r.ok && issue) {
      await api(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Résolu : ${r.site} · ${r.certificat} · ${r.domaine}.` }) });
      await api(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      console.log(`→ alerte fermée : ${titre}`);
    }
  }
}
