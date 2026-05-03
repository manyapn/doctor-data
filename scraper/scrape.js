'use strict';

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { DOCTOR_CONFIGS } = require('./config');
const DoctorNormalizer = require('./normalizer');

const DELAY_MS = 1500;
const OUTPUT_PATH = path.resolve(__dirname, '../data/doctors.json');
const BROWSER_CONTEXT_OPTIONS = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
};

function toTitleCase(str) {
  return str ? str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '';
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function classifyError(err) {
  if (err.httpStatus) {
    const isBlock = [401, 403, 407, 429].includes(err.httpStatus);
    return { status: String(err.httpStatus), error: isBlock ? 'Blocked' : `HTTP ${err.httpStatus}` };
  }
  if (/timeout/i.test(err.message)) return { status: 'error', error: 'Timed out' };
  if (/net::ERR|Failed to navigate|ERR_CONNECTION/i.test(err.message))
    return { status: 'error', error: 'Connection refused' };
  return { status: 'error', error: err.message.slice(0, 80) };
}

function okResult(name, data) {
  return { name, status: '200', error: null, data };
}

function errorResult(name, err) {
  const e = classifyError(err);
  console.error(`  [${name}] ${e.error}`);
  return { name, ...e, data: null };
}

async function scrapeSource(name, url, scrape) {
  try {
    console.log(`  [${name}] ${url}`);
    const data = await scrape();
    return okResult(name, data);
  } catch (err) {
    return errorResult(name, err);
  }
}

function cleanDoctorName(name) {
  return name?.replace(/^Dr\.?\s*/i, '').trim() || null;
}

function coerceMedicalSpecialty(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const specialties = value
      .map(coerceMedicalSpecialty)
      .filter(Boolean);
    return specialties.length ? specialties.join(', ') : null;
  }
  if (typeof value === 'object') {
    return coerceMedicalSpecialty(value.name || value.text || value.label || value['@type'] || value['@id']);
  }
  return null;
}

function normalizeProviderData(data) {
  const normalized = {
    ...data,
    name: cleanDoctorName(data.name),
    specialty: coerceMedicalSpecialty(data.specialty),
  };
  if (data.description) normalized.description = cleanSummary(data.description);
  return normalized;
}

function cleanSummary(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDoximityAchievements(lines, doctorLastName) {
  const start = lines.findIndex(line => /Publications & Presentations/i.test(line));
  if (start < 0) return [];

  const end = lines.findIndex((line, index) =>
    index > start && /Professional Memberships|Industry Relationships|Viewing the full profile|Similar Physicians/i.test(line)
  );
  const section = lines.slice(start + 1, end > start ? end : undefined);
  const categories = new Set(['PubMed', 'Journal Articles', 'Abstracts/Posters', 'Lectures']);
  const achievements = [];
  let category = null;

  for (let i = 0; i < section.length; i += 1) {
    const line = section[i];
    if (categories.has(line)) {
      category = line;
      continue;
    }
    if (!category || /^\d+\s+citations?$/i.test(line)) continue;

    const title = line;
    const details = [];
    let cursor = i + 1;

    if (category === 'Lectures') {
      const detail = section[cursor] || '';
      if (/\b(19|20)\d{2}\b/.test(`${title} ${detail}`)) {
        achievements.push({
          title,
          details: detail,
          type: category,
          source: 'Doximity',
        });
        i = cursor;
      }
      continue;
    }

    while (cursor < section.length && !categories.has(section[cursor]) && !/^\d+\s+citations?$/i.test(section[cursor])) {
      details.push(section[cursor]);
      cursor += 1;
      if (details.some(detail => /\b(19|20)\d{2}(?:-\d{2}-\d{2}|\/\d{1,2}\/\d{4})?\b/.test(detail))) break;
    }

    const combined = `${title} ${details.join(' ')}`;
    const hasDate = /\b(19|20)\d{2}(?:-\d{2}-\d{2}|\/\d{1,2}\/\d{4})?\b/.test(combined);
    const hasDoctor = new RegExp(`\\b${doctorLastName}\\b`, 'i').test(combined);
    const lecture = category === 'Lectures' && hasDate;

    if (hasDate && (hasDoctor || lecture)) {
      achievements.push({
        title,
        details: details.join(' | '),
        type: category,
        source: 'Doximity',
      });
      i = cursor - 1;
    }
  }

  return achievements.slice(0, 10);
}

function logSourceSummary(source, data, parts = []) {
  const suffix = parts.length ? ` | ${parts.join(' | ')}` : '';
  console.log(`  [${source}] OK - ${data.name || '?'}${suffix}`);
}

async function scrapeNPI(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    if (!data.results?.length) return { name: 'NPI', status: 'error', error: 'No results', data: null };

    const r       = data.results[0];
    const basic   = r.basic || {};
    const tax     = (r.taxonomies || []).find(t => t.primary) || r.taxonomies?.[0] || {};
    const addr    = (r.addresses || []).find(a => a.address_purpose === 'LOCATION') || r.addresses?.[0] || {};

    return okResult('NPI', {
      npiNumber:   r.number || null,
      name:        [basic.first_name, basic.middle_name, basic.last_name].filter(Boolean).map(toTitleCase).join(' '),
      credentials: basic.credential || 'MD',
      specialty:   tax.desc || null,
      city:        addr.city ? toTitleCase(addr.city) : null,
      state:       addr.state || null,
    });
  } catch (err) {
    return errorResult('NPI', err);
  }
}

async function navigate(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const status = resp?.status();
  if (status && status >= 400) {
    const e = new Error(`HTTP ${status}`);
    e.httpStatus = status;
    throw e;
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}

async function scrapeHealthgrades(page, url) {
  const SRC = 'Healthgrades';
  const result = await scrapeSource(SRC, url, async () => {
    await navigate(page, url);
    await page.waitForSelector('h1', { timeout: 12000 }).catch(() => {});

    return page.evaluate(() => {
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);

      const entities = jsonLd.flatMap(b => [b, b?.mainEntity].filter(Boolean));
      const physician = entities.find(b => b?.['@type'] === 'Physician' && (b.name || b.medicalSpecialty || b.medicalspecialty)) || {};
      const ratingEntity = entities.find(b => {
        const ag = b?.aggregateRating;
        const count = parseInt(ag?.reviewCount ?? ag?.ratingCount ?? 0, 10);
        return ag?.ratingValue != null && count > 0;
      }) || {};
      const agRating = ratingEntity.aggregateRating || {};

      const name        = physician.name || document.querySelector('h1')?.innerText?.trim() || null;
      const specialty   = physician.medicalSpecialty || physician.medicalspecialty || null;
      const rating      = agRating.ratingValue != null ? parseFloat(agRating.ratingValue) : null;
      const reviewCount = agRating.reviewCount != null
        ? parseInt(agRating.reviewCount, 10)
        : agRating.ratingCount != null
          ? parseInt(agRating.ratingCount, 10)
          : null;
      const description = physician.description    || null;

      const quotes = [...document.querySelectorAll(
        '[class*="ReviewComment" i],[class*="comment-text" i],[class*="reviewText" i],[class*="review-text" i]'
      )].slice(0, 3).map(el => ({
        text:   el.innerText.trim().replace(/^["""“”]|["""“”]$/g, ''),
        source: 'Healthgrades',
        date:   null,
      })).filter(q => q.text.length > 10);

      return { name, specialty, rating, reviewCount, description, quotes, eduRows: [] };
    });
  });
  if (result.data) result.data = normalizeProviderData(result.data);
  if (result.data) {
    logSourceSummary(SRC, result.data, [result.data.specialty || '?', `rating: ${result.data.rating ?? '?'}`]);
  }
  return result;
}

async function scrapeDoximity(page, url) {
  const SRC = 'Doximity';
  const result = await scrapeSource(SRC, url, async () => {
    await navigate(page, url);
    await page.waitForSelector('h1,[class*="profile"]', { timeout: 12000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const text = sel => document.querySelector(sel)?.innerText?.trim() || null;

      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);
      const entity = jsonLd.find(b => b?.mainEntity)?.mainEntity || jsonLd.find(b => b?.['@type'] === 'Person') || {};

      const name        = text('h1') || entity.name || null;
      const specialty   = text('[class*="specialty" i]') || null;
      const credentials = text('[class*="credential" i]') || null;

      let affiliation = null;
      const descMatch = (entity.description || '').match(/affiliated with ([^.]+)/i);
      if (descMatch) affiliation = descMatch[1].trim();

      const eduItems = [...document.querySelectorAll(
        '[class*="education" i] li,[class*="Education" i] li,[class*="training" i] li'
      )].slice(0, 6).map(el => el.innerText?.trim()).filter(Boolean);
      const lines = document.body.innerText.split('\n').map(line => line.trim()).filter(Boolean);

      return { name, specialty, credentials, affiliation, description: entity.description || null, eduItems, lines };
    });

    const lastName = url.includes('jose-marin') ? 'Marin' : url.includes('john-hawkins') ? 'Hawkins' : 'Golive';
    data.publications = parseDoximityAchievements(data.lines || [], lastName);
    delete data.lines;
    return data;
  });
  if (result.data) result.data = normalizeProviderData(result.data);
  if (result.data) {
    logSourceSummary(SRC, result.data, [`edu: ${result.data.eduItems?.length ?? 0}`, `affil: ${result.data.affiliation || 'none'}`]);
  }
  return result;
}

async function scrapeUSNews(page, url) {
  const SRC = 'US News';
  const result = await scrapeSource(SRC, url, async () => {
    await navigate(page, url);
    await page.waitForSelector('h1,[class*="doctor"]', { timeout: 12000 }).catch(() => {});

    return page.evaluate(() => {
      const text = sel => document.querySelector(sel)?.innerText?.trim() || null;

      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);
      const entities = jsonLd.flatMap(b => [b, b?.mainEntity].filter(Boolean));

      const name      = text('h1') || text('[class*="doctor-name" i]') || null;
      const specialty = text('[class*="specialty" i]') || null;
      const description =
        [...entities.map(entity => entity.description), document.querySelector('meta[name="description"]')?.content]
          .find(value => value && String(value).length > 80) || null;

      const eduItems = [...document.querySelectorAll(
        '[class*="education" i] li,[class*="medical-school" i],[class*="residency" i]'
      )].slice(0, 5).map(el => el.innerText?.trim()).filter(Boolean);

      const ratingEntity = entities.find(b => {
        const ag = b?.aggregateRating;
        const count = parseInt(ag?.reviewCount ?? ag?.ratingCount ?? 0, 10);
        return ag?.ratingValue != null && count > 0;
      }) || {};
      const agRating = ratingEntity.aggregateRating || {};
      const rating = agRating.ratingValue != null ? parseFloat(agRating.ratingValue) : null;
      const reviewCount = agRating.reviewCount != null
        ? parseInt(agRating.reviewCount, 10)
        : agRating.ratingCount != null
          ? parseInt(agRating.ratingCount, 10)
          : null;

      const quotes = [...document.querySelectorAll('[class*="review" i] p,[class*="comment" i] p')]
        .slice(0, 3).map(el => ({
          text:   el.innerText.trim().replace(/^["""]|["""]$/g, ''),
          source: 'US News',
          date:   null,
        })).filter(q => q.text.length > 10);

      return { name, specialty, description, rating, reviewCount, eduItems, quotes };
    });
  });
  if (result.data) result.data = normalizeProviderData(result.data);
  if (result.data) {
    logSourceSummary(SRC, result.data, [`edu: ${result.data.eduItems?.length ?? 0}`, `rating: ${result.data.rating ?? '?'}`]);
  }
  return result;
}

async function scrapeVitals(page, url) {
  const SRC = 'Vitals';
  const result = await scrapeSource(SRC, url, async () => {
    await navigate(page, url);
    await page.waitForSelector('h1,[class*="doctor"]', { timeout: 12000 }).catch(() => {});

    return page.evaluate(() => {
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);
      const entity = jsonLd.find(b => b?.mainEntity?.['@type'] === 'Physician')?.mainEntity
                  || jsonLd.find(b => b?.['@type'] === 'Physician') || {};
      const entities = jsonLd.flatMap(b => [b, b?.mainEntity].filter(Boolean));

      const name      = entity.name || document.querySelector('h1')?.innerText?.trim() || null;
      const specialty = entity.medicalSpecialty || entity.medicalspecialty || null;
      const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim();
      const bioMatch = bodyText.match(/Dr\.?\s+[A-Z][^.]+? is a health care provider primarily located.*?(?:areas of expertise[^.]*\.|insurance plans\.|accepting new patients\.)/i);
      const description = entity.description || document.querySelector('meta[name="description"]')?.content || bioMatch?.[0] || null;
      const affiliationMatch = (description || '').match(/affiliated with ([^.]+)/i);
      const affiliation = affiliationMatch ? affiliationMatch[1].trim() : null;

      const eduContainer = document.querySelector('[class*="edu" i],[class*="train" i],[class*="certif" i]');
      const eduBlob = eduContainer?.innerText || '';
      const eduItems = [];
      const medSchoolM = eduBlob.match(/MEDICAL SCHOOL\s*\n([A-Za-z][^\n]+?)Graduated in (\d{4})/i);
      if (medSchoolM) eduItems.push(`${medSchoolM[1].trim()}\nClass of ${medSchoolM[2]}`);
      const residencyM = eduBlob.match(/RESIDENCY\s*\n([A-Za-z][^\n]+?)(?:Graduated in (\d{4}))?/i);
      if (residencyM) eduItems.push(`${residencyM[1].trim()}${residencyM[2] ? '\nResidency, ' + residencyM[2] : ''}`);
      const fellowshipM = eduBlob.match(/FELLOWSHIP\s*\n([A-Za-z][^\n]+?)(?:Graduated in (\d{4}))?/i);
      if (fellowshipM) eduItems.push(`${fellowshipM[1].trim()}${fellowshipM[2] ? '\nFellowship, ' + fellowshipM[2] : ''}`);

      const ratingEntity = entities.find(b => {
        const ag = b?.aggregateRating;
        const count = parseInt(ag?.reviewCount ?? ag?.ratingCount ?? 0, 10);
        return ag?.ratingValue != null && count > 0;
      }) || {};
      const agRating = ratingEntity.aggregateRating || {};
      const rating = agRating.ratingValue != null ? parseFloat(agRating.ratingValue) : null;
      const reviewCount = agRating.reviewCount != null
        ? parseInt(agRating.reviewCount, 10)
        : agRating.ratingCount != null
          ? parseInt(agRating.ratingCount, 10)
          : null;

      const quotes = [...document.querySelectorAll('[class*="review" i] p,[class*="comment" i] p')]
        .slice(0, 3).map(el => ({
          text:   el.innerText.trim().replace(/^["""""]|["""""]$/g, ''),
          source: 'Vitals',
          date:   null,
        })).filter(q => q.text.length > 10);

      return { name, specialty, description, affiliation, rating, reviewCount, eduItems, quotes };
    });
  });
  if (result.data) result.data = normalizeProviderData(result.data);
  if (result.data) {
    logSourceSummary(SRC, result.data, [`edu: ${result.data.eduItems?.length ?? 0}`, `rating: ${result.data.rating ?? '?'}`]);
  }
  return result;
}

async function createBrowserContext() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  return { browser, context: await browser.newContext(BROWSER_CONTEXT_OPTIONS) };
}

async function scrapeDoctor(config, page, normalizer) {
  console.log(`\n=== ${config.firstName} ${config.lastName} (${config.stateCode}) ===`);

  const npi = await scrapeNPI(config.npiUrl);
  console.log(`  [NPI] ${npi.error ?? 'OK - ' + (npi.data?.name || '?')}`);

  const healthgrades = await scrapeHealthgrades(page, config.healthgradesUrl);
  await delay(DELAY_MS);

  const doximity = await scrapeDoximity(page, config.doximityUrl);
  await delay(DELAY_MS);

  const usNews = await scrapeUSNews(page, config.usnewsUrl);
  await delay(DELAY_MS);

  const vitals = await scrapeVitals(page, config.vitalsUrl);
  await delay(DELAY_MS);

  const profile = normalizer.normalize(config, [npi, healthgrades, doximity, usNews, vitals]);
  console.log(`  → ${profile.name} | ${profile.specialty || '?'} | ${profile.city || '?'}, ${profile.stateCode}`);
  return profile;
}

function writeOutput(doctors) {
  const output = { collected_at: new Date().toISOString(), doctors };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${doctors.length} profiles → ${OUTPUT_PATH}`);
}

async function main() {
  const { browser, context } = await createBrowserContext();

  try {
    const page = await context.newPage();
    const normalizer = new DoctorNormalizer();
    const doctors = [];

    for (const config of DOCTOR_CONFIGS) {
      doctors.push(await scrapeDoctor(config, page, normalizer));
    }

    writeOutput(doctors);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

module.exports = {
  classifyError,
  coerceMedicalSpecialty,
  normalizeProviderData,
  cleanDoctorName,
};
