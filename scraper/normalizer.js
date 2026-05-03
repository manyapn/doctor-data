'use strict';

const {
  EXPERIENCE_SOURCES,
  REVIEW_SOURCES,
  SOURCE_COLORS,
  SOURCE_ORDER,
} = require('./config');

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

function ok(sourceMap, name) {
  return sourceMap[name]?.status === '200' && sourceMap[name]?.data != null;
}

function dataFor(sourceMap, name) {
  return ok(sourceMap, name) ? sourceMap[name].data : {};
}

function displaySourceName(name) {
  return name === 'NPI' ? 'NPPES' : name;
}

function sourceUrls(config) {
  return {
    NPI: config.npiUrl,
    Healthgrades: config.healthgradesUrl,
    Doximity: config.doximityUrl,
    'US News': config.usnewsUrl,
    Vitals: config.vitalsUrl,
  };
}

function displaySpecialty(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 && /^internal medicine$/i.test(parts[0])) {
    return parts.slice(1).join(', ');
  }
  return String(raw).trim();
}

function parseEduString(raw, source) {
  const full = String(raw).trim();
  const lines = full.split('\n').map(line => line.trim()).filter(Boolean);
  const school = lines[0] || full;

  let type = 'Medical School';
  if (/fellowship/i.test(full)) type = 'Fellowship';
  else if (/residency|resident/i.test(full)) type = 'Residency';
  else if (/internship|intern\b/i.test(full)) type = 'Internship';

  const years = full.match(/\b(19|20)\d{2}\b/g);
  const year = years ? parseInt(years[years.length - 1], 10) : null;

  return { type, school, location: '', year, source };
}

function educationKey(entry) {
  const school = (entry.school || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${school}|${entry.type}`;
}

function normalizeEducationItem(item, sourceName) {
  if (typeof item === 'string') return parseEduString(item, sourceName);
  if (!item || typeof item !== 'object') return null;
  return { ...item, location: item.location || '', source: item.source || sourceName };
}

function buildBaseProfile(config, npi) {
  return {
    id: config.id,
    name: npi.name || null,
    credentials: npi.credentials || null,
    specialty: displaySpecialty(npi.specialty),
    taxonomy: npi.specialty || null,
    subspecialty: null,
    city: npi.city || null,
    state: STATE_NAMES[npi.state || config.stateCode] || config.stateCode,
    stateCode: npi.state || config.stateCode,
    education: [],
    experience: {
      yearsInPractice: null,
      clinicalFocus: null,
      affiliation: null,
      credentials: null,
      summary: '',
      summarySource: null,
      fieldSources: {},
      sources: [],
    },
    reviews: {
      rating: null,
      reviewCount: null,
      reviewSources: [],
      ratings: [],
      viewMoreUrl: config.healthgradesUrl,
      quotes: [],
    },
    research: {
      publications: [],
    },
    sources: [],
  };
}

function patchMissingProfileFields(profile, config, sourceMap) {
  for (const source of EXPERIENCE_SOURCES) {
    const data = dataFor(sourceMap, source);
    if (!data) continue;

    if (!profile.name && data.name) profile.name = data.name;
    if (!profile.specialty && data.specialty) profile.specialty = displaySpecialty(data.specialty);
    if (!profile.city && data.city) profile.city = data.city;
    if (!profile.credentials && data.credentials) profile.credentials = data.credentials;
    if (!profile.experience.affiliation && data.affiliation) {
      profile.experience.affiliation = data.affiliation;
    }
  }

  if (!profile.name) profile.name = `${config.firstName} ${config.lastName}`;
  if (!profile.credentials) profile.credentials = 'MD';
}

function collectEducation(sourceMap) {
  const byKey = new Map();

  for (const source of SOURCE_ORDER) {
    const data = dataFor(sourceMap, source);
    const sourceName = displaySourceName(source);
    const items = data.education || data.eduItems || data.eduRows || [];

    for (const item of items) {
      const entry = normalizeEducationItem(item, sourceName);
      if (!entry) continue;

      const key = educationKey(entry);
      if (key && !byKey.has(key)) byKey.set(key, entry);
    }
  }

  return Array.from(byKey.values()).slice(0, 5);
}

function earliestMedicalSchoolYear(education) {
  return education
    .filter(entry => entry.type === 'Medical School')
    .map(entry => entry.year)
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;
}

function latestEducationYear(education) {
  return education
    .map(entry => entry.year)
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;
}

function fillExperience(profile, sourceMap, urls) {
  const startYear = earliestMedicalSchoolYear(profile.education) || latestEducationYear(profile.education);
  const educationSource = profile.education.find(entry => entry.type === 'Medical School')?.source
    || profile.education.find(entry => entry.year)?.source;
  if (startYear) {
    profile.experience.yearsInPractice = new Date().getFullYear() - startYear;
    profile.experience.fieldSources.yearsInPractice = {
      source: educationSource,
      url: urls[educationSource === 'NPPES' ? 'NPI' : educationSource] || '#',
    };
  }

  profile.experience.clinicalFocus = profile.specialty;
  profile.experience.credentials = profile.credentials;
  profile.experience.fieldSources.clinicalFocus = { source: 'NPPES', url: urls.NPI };
  profile.experience.fieldSources.credentials = { source: 'NPPES', url: urls.NPI };
  if (profile.experience.affiliation) {
    const affiliationSource = EXPERIENCE_SOURCES.find(source => dataFor(sourceMap, source).affiliation === profile.experience.affiliation);
    profile.experience.fieldSources.affiliation = { source: affiliationSource, url: urls[affiliationSource] || '#' };
  }

  for (const source of EXPERIENCE_SOURCES) {
    if (ok(sourceMap, source)) profile.experience.sources.push(source);
  }

  const summarySource = ['US News', 'Vitals', 'Doximity', 'Healthgrades']
    .map(source => ({ source, description: dataFor(sourceMap, source).description }))
    .filter(item => item.description && item.description.length > 80)
    .sort((a, b) => b.description.length - a.description.length)[0];
  if (summarySource) {
    profile.experience.summary = summarySource.description;
    profile.experience.summarySource = { source: summarySource.source, url: urls[summarySource.source] || '#' };
  }
}

function collectResearch(sourceMap, urls) {
  return SOURCE_ORDER.flatMap(source => {
    const publications = dataFor(sourceMap, source).publications || [];
    return publications.map(item => ({
      ...item,
      source,
      url: item.url || urls[source] || '#',
      color: SOURCE_COLORS[source],
    }));
  }).slice(0, 12);
}

function hasUsableReviewRating(data) {
  return data.rating != null && data.reviewCount !== 0;
}

function fillReviews(profile, sourceMap, urls) {
  const ratings = [];

  for (const source of REVIEW_SOURCES) {
    const data = dataFor(sourceMap, source);
    if (!data) continue;

    if (hasUsableReviewRating(data)) {
      ratings.push(data.rating);
      profile.reviews.ratings.push({
        source,
        rating: data.rating,
        url: urls[source],
        color: SOURCE_COLORS[source],
      });
      if (!profile.reviews.reviewSources.includes(source)) {
        profile.reviews.reviewSources.push(source);
      }
    }

    if (!profile.reviews.reviewCount && data.reviewCount) {
      profile.reviews.reviewCount = data.reviewCount;
    }

    if (data.quotes?.length) {
      profile.reviews.quotes = [...profile.reviews.quotes, ...data.quotes].slice(0, 5);
    }
  }

  if (ratings.length) {
    const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    profile.reviews.rating = Math.round(average * 10) / 10;
  }
}

function buildSourceStatus(rawSources, urls) {
  return rawSources.map(source => ({
    name: displaySourceName(source.name),
    url: urls[source.name] || '#',
    color: SOURCE_COLORS[source.name] || '#9ca3af',
    status: source.status,
    error: source.error || null,
  }));
}

class DoctorNormalizer {
  normalize(config, rawSources) {
    const sourceMap = Object.fromEntries(rawSources.map(source => [source.name, source]));
    const urls = sourceUrls(config);
    const profile = buildBaseProfile(config, dataFor(sourceMap, 'NPI'));

    patchMissingProfileFields(profile, config, sourceMap);
    profile.education = collectEducation(sourceMap);
    fillExperience(profile, sourceMap, urls);
    fillReviews(profile, sourceMap, urls);
    profile.research.publications = collectResearch(sourceMap, urls);
    profile.sources = buildSourceStatus(rawSources, urls);

    return profile;
  }
}

module.exports = DoctorNormalizer;
