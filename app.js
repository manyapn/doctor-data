const SOURCE_DEFS = {
  Doximity: { url: 'https://www.doximity.com', color: '#3b82f6' },
  Healthgrades: { url: 'https://www.healthgrades.com', color: '#f59e0b' },
  Vitals: { url: 'https://www.vitals.com', color: '#ef4444' },
  'US News': { url: 'https://health.usnews.com/doctors', color: '#0d9488' },
  NPPES: { url: 'https://npiregistry.cms.hhs.gov', color: '#8b5cf6' },
};

let DOCTORS = [];
let collectedAt = null;

const tabs = document.getElementById('doctor-tabs');
const profileRoot = document.getElementById('profile-root');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function srcColor(name) {
  return SOURCE_DEFS[name]?.color ?? '#9ca3af';
}

function srcUrl(name) {
  return SOURCE_DEFS[name]?.url ?? '#';
}

function sourceLink(name, url = srcUrl(name), color = srcColor(name)) {
  const link = el('a', 'source-link', name);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.style.color = color;
  return link;
}

function sourceBadge(name) {
  const badge = el('span', 'source-badge', name);
  badge.style.color = srcColor(name);
  return badge;
}

function renderTabs(activeId) {
  tabs.textContent = '';

  DOCTORS.forEach(doctor => {
    const item = el('li', 'nav-item');

    const link = el('a', `nav-link${doctor.id === activeId ? ' active' : ''}`, `${doctor.name}  ·  ${doctor.stateCode}`);
    link.href = '#';
    link.addEventListener('click', event => {
      event.preventDefault();
      selectDoctor(doctor.id);
    });

    item.appendChild(link);
    tabs.appendChild(item);
  });
}

function renderProfile(doctor) {
  profileRoot.textContent = '';

  const card = el('article', 'profile-card mb-4');
  const body = el('div', 'p-4');
  body.append(
    renderProfileHeader(doctor),
    renderOverview(doctor.experience.summary, doctor.experience.summarySource),
    renderEducation(doctor.education),
    renderExperience(doctor.experience),
    renderResearch(doctor.research),
    renderReviews(doctor.reviews),
    renderSources(doctor.sources),
  );

  card.appendChild(body);

  if (collectedAt) {
    const footer = el('div');
    footer.style.cssText = 'border-top:1px solid #e3e7ed;padding:10px 18px;font-size:11px;color:#9ca3af;font-family:"DM Mono",monospace;';
    footer.textContent = `Data collected: ${new Date(collectedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    card.appendChild(footer);
  }

  profileRoot.appendChild(card);
}

function renderProfileHeader(doctor) {
  const wrapper = el('div', 'profile-header-row mb-0');
  const main = el('div');
  const title = el('h1', 'profile-title', `${doctor.name}, ${doctor.credentials}`);
  const meta = el(
    'div',
    'profile-meta',
    `${doctor.specialty}${doctor.subspecialty ? ` · ${doctor.subspecialty}` : ''}  ·  ${doctor.city}, ${doctor.state}`
  );

  main.append(title, meta);
  wrapper.append(main);
  return wrapper;
}

function renderOverview(summary, source) {
  if (!summary) return document.createDocumentFragment();
  const section = sectionShell('Overview');
  const text = el('p', 'profile-overview', summary);
  section.appendChild(text);
  if (source?.url) {
    const meta = el('div', 'field-source');
    meta.append('Source: ', sourceBadgeLink(source.source, source.url));
    section.appendChild(meta);
  }
  return section;
}

function renderEducation(education) {
  const section = sectionShell('Education');

  education.forEach((entry, index) => {
    const row = el('div', `edu-row${index < education.length - 1 ? ' pb-3 mb-3 border-bottom' : ''}`);

    const year = el('span', 'edu-year', entry.year ?? '-');
    const schoolWrap = el('div', 'flex-grow-1');
    const school = el('span', 'edu-school', entry.school);
    const location = el('span', 'edu-location', entry.location);
    const type = el('span', 'edu-type', entry.type);

    schoolWrap.append(school, location);
    row.append(year, schoolWrap, type, sourceBadge(entry.source));
    section.appendChild(row);
  });

  return section;
}

function renderExperience(experience) {
  const section = sectionShell('Experience');
  const rows = [
    ['Years since graduation', experience.yearsInPractice != null ? `${experience.yearsInPractice} years` : null, experience.fieldSources?.yearsInPractice],
    ['Specialty', experience.clinicalFocus, experience.fieldSources?.clinicalFocus],
    ['Credentials', experience.credentials, experience.fieldSources?.credentials],
    ['Affiliation', experience.affiliation, experience.fieldSources?.affiliation],
  ];

  rows.filter(([, value]) => value).forEach(([label, value, source]) => {
    const row = el('div', 'exp-row');
    const labelEl = el('span', 'exp-label', label);
    const valueEl = el('span', 'exp-value', value);
    if (source?.url) valueEl.append(' ', sourceBadgeLink(source.source, source.url));

    row.append(labelEl, valueEl);
    section.appendChild(row);
  });

  return section;
}

function sourceBadgeLink(name, url) {
  const link = sourceLink(name, url, srcColor(name));
  link.className = 'source-badge source-badge-link';
  return link;
}

function renderResearch(research) {
  const publications = research?.publications || [];
  if (!publications.length) return document.createDocumentFragment();

  const section = sectionShell('Research');
  const groups = publications.reduce((acc, item) => {
    const key = item.type || 'Publications';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  Object.entries(groups).forEach(([type, items]) => {
    section.appendChild(el('div', 'research-group-label', type));
    items.forEach((publication, index) => {
      const item = el('div', index < items.length - 1 ? 'research-item pb-3 mb-3 border-bottom' : 'research-item');
      const title = el('div', 'research-title', publication.title);
      const meta = el('div', 'research-meta');
      meta.append(
        publication.details || publication.citation || '',
        publication.source ? ' · ' : '',
        publication.source ? sourceBadgeLink(publication.source, publication.url) : ''
      );
      item.append(title, meta);
      section.appendChild(item);
    });
  });

  return section;
}

function renderReviews(reviews) {
  const section = sectionShell('Patient Reviews');

  if (reviews.rating == null) {
    const empty = el('p', 'text-muted small mb-0', 'No accessible patient rating found in the scraped sources.');
    section.appendChild(empty);
    return section;
  }

  const ratingRow = el('div', 'd-flex align-items-baseline gap-3 mb-3');
  const rating = el('span', 'rating-num', reviews.rating);
  const caption = el('span');
  caption.style.fontSize = '13px';
  caption.style.color = '#6b7280';
  caption.textContent = reviews.ratings?.length > 1
    ? `/ 5 average from accessible review sources`
    : `/ 5 from accessible review metadata`;
  ratingRow.append(rating, caption);
  section.appendChild(ratingRow);

  if (reviews.ratings?.length) {
    const breakdown = el('div', 'rating-breakdown');
    reviews.ratings.forEach(item => {
      const link = sourceLink(item.source, item.url, item.color);
      link.className = 'rating-pill';
      link.textContent = `${item.source}: ${item.rating}/5`;
      breakdown.appendChild(link);
    });
    section.appendChild(breakdown);
  }

  if (reviews.reviewCount) {
    const count = el(
      'div',
      'review-count-note',
      `${reviews.reviewCount} review${reviews.reviewCount === 1 ? '' : 's'} reported by scraped source metadata.`
    );
    section.appendChild(count);
  }

  reviews.quotes.forEach((quote, index) => {
    const wrap = el('div');
    const text = el('p', 'review-quote mb-1', `"${quote.text}"`);
    const meta = el('div', 'review-meta');
    const date = el('span', 'ms-2', quote.date);

    wrap.className = index < reviews.quotes.length - 1 ? 'pb-3 mb-3 border-bottom' : '';

    meta.append(sourceBadge(quote.source), date);
    wrap.append(text, meta);
    section.appendChild(wrap);
  });

  return section;
}

function renderSources(sources) {
  const section = sectionShell('Scrape Status');
  const list = el('div', 'source-status-list');

  sources.forEach(source => {
    const item = el('div', 'source-status-item');
    const dot = el('span', 'source-dot');
    const status = el('span', source.status === '200' ? 'source-ok' : 'source-error', source.status === '200' ? 'scraped' : source.error);

    dot.style.background = source.status === '200' ? '#22c55e' : '#ef4444';

    item.append(dot, sourceLink(source.name, source.url, '#374151'), status);
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

function sectionShell(label) {
  const section = el('section', 'profile-section');
  const title = el('div', 'section-label', label);
  section.appendChild(title);
  return section;
}

function selectDoctor(id) {
  const doctor = DOCTORS.find(item => item.id === id);
  if (!doctor) return;
  renderTabs(id);
  renderProfile(doctor);
}

async function fetchJson(path) {
  try {
    const response = await fetch(path);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function loadDoctorData() {
  const liveData = await fetchJson('data/doctors.json');
  if (liveData) return { data: liveData, fromSeed: false };

  const seedData = await fetchJson('data/doctors.seed.json');
  if (seedData) return { data: seedData, fromSeed: true };

  return { data: null, fromSeed: false };
}

async function init() {
  const meta = document.getElementById('collection-meta');
  profileRoot.innerHTML = '<p style="color:#9ca3af;padding:18px">Loading...</p>';

  const { data, fromSeed } = await loadDoctorData();

  if (!data) {
    profileRoot.innerHTML = `
      <div class="empty-state" style="padding:32px 18px;color:#6b7280;font-size:13px">
        <p style="margin-bottom:8px">No data found. Populate profiles by running the scraper:</p>
        <code style="display:block;background:#f7f8fa;border:1px solid #e3e7ed;border-radius:6px;padding:10px 14px;font-size:12px;color:#374151">cd scraper &amp;&amp; npm install &amp;&amp; npm run scrape</code>
      </div>`;
    meta.textContent = 'No data loaded';
    return;
  }

  DOCTORS     = data.doctors || [];
  collectedAt = data.collected_at || null;

  if (collectedAt) {
    const d       = new Date(collectedAt);
    const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    meta.textContent = fromSeed
      ? `Showing cached data · Last scraped: ${dateStr}`
      : `Last scraped: ${dateStr}`;
  }

  if (DOCTORS.length > 0) selectDoctor(DOCTORS[0].id);
}

init();
