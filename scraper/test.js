'use strict';

const assert = require('assert/strict');
const DoctorNormalizer = require('./normalizer');
const {
  classifyError,
  coerceMedicalSpecialty,
  normalizeProviderData,
  cleanDoctorName,
} = require('./scrape');

function testSpecialtyCoercion() {
  assert.equal(coerceMedicalSpecialty('Cardiology'), 'Cardiology');
  assert.equal(coerceMedicalSpecialty({ name: 'Family Medicine' }), 'Family Medicine');
  assert.equal(coerceMedicalSpecialty({ '@type': 'Cardiovascular' }), 'Cardiovascular');
  assert.equal(
    coerceMedicalSpecialty([{ name: 'Internal Medicine' }, { name: 'Cardiovascular Disease' }]),
    'Internal Medicine, Cardiovascular Disease'
  );
  assert.equal(coerceMedicalSpecialty(null), null);
}

function testProviderDataNormalization() {
  assert.equal(cleanDoctorName('Dr. John C Hawkins'), 'John C Hawkins');
  assert.deepEqual(
    normalizeProviderData({
      name: 'Dr. Anjani Golive',
      specialty: [{ name: 'Internal Medicine' }, { name: 'Cardiovascular Disease' }],
      rating: 4.6,
    }),
    {
      name: 'Anjani Golive',
      specialty: 'Internal Medicine, Cardiovascular Disease',
      rating: 4.6,
    }
  );
}

function testErrorClassification() {
  const forbidden = new Error('HTTP 403');
  forbidden.httpStatus = 403;
  assert.deepEqual(classifyError(forbidden), { status: '403', error: 'Blocked' });

  const missing = new Error('HTTP 404');
  missing.httpStatus = 404;
  assert.deepEqual(classifyError(missing), { status: '404', error: 'HTTP 404' });

  assert.deepEqual(classifyError(new Error('net::ERR_CONNECTION_REFUSED')), {
    status: 'error',
    error: 'Connection refused',
  });
}

function testNormalizerMergesCaseStudyFields() {
  const normalizer = new DoctorNormalizer();
  const profile = normalizer.normalize(
    {
      id: 'hawkins',
      firstName: 'John',
      lastName: 'Hawkins',
      stateCode: 'GA',
      healthgradesUrl: 'https://example.com/healthgrades',
      doximityUrl: 'https://example.com/doximity',
      usnewsUrl: 'https://example.com/usnews',
      vitalsUrl: 'https://example.com/vitals',
      npiUrl: 'https://example.com/npi',
    },
    [
      {
        name: 'NPI',
        status: '200',
        error: null,
        data: {
          name: 'John C Hawkins',
          credentials: 'M.D.',
          specialty: 'Internal Medicine, Cardiovascular Disease',
          city: 'Macon',
          state: 'GA',
        },
      },
      {
        name: 'Healthgrades',
        status: '200',
        error: null,
        data: { rating: 4.4, reviewCount: 12, quotes: [] },
      },
      {
        name: 'Doximity',
        status: '200',
        error: null,
        data: {
          affiliation: 'Medical Center, Navicent Health',
          eduItems: [
            'Medical College of Georgia at Augusta University\nMedical School, Class of 1977',
            'Medical College of Georgia\nResidency, 1977 - 1980',
            'Medical College of Georgia\nFellowship, 1980 - 1982',
          ],
        },
      },
      { name: 'US News', status: 'error', error: 'Connection refused', data: null },
      { name: 'Vitals', status: '403', error: 'Blocked', data: null },
    ]
  );

  assert.equal(profile.name, 'John C Hawkins');
  assert.equal(profile.city, 'Macon');
  assert.equal(profile.specialty, 'Cardiovascular Disease');
  assert.equal(profile.taxonomy, 'Internal Medicine, Cardiovascular Disease');
  assert.equal(profile.experience.affiliation, 'Medical Center, Navicent Health');
  assert.equal(profile.experience.yearsInPractice, new Date().getFullYear() - 1977);
  assert.equal(profile.experience.fieldSources.yearsInPractice.source, 'Doximity');
  assert.equal(profile.experience.fieldSources.affiliation.url, 'https://example.com/doximity');
  assert.equal(profile.education.length, 3);
  assert.deepEqual(profile.education.map(e => e.year), [1977, 1980, 1982]);
  assert.equal(profile.reviews.rating, 4.4);
  assert.equal(profile.reviews.reviewCount, 12);
  assert.deepEqual(profile.reviews.ratings, [
    {
      source: 'Healthgrades',
      rating: 4.4,
      url: 'https://example.com/healthgrades',
      color: '#f59e0b',
    },
  ]);
}

function testNormalizerUsesUsNewsSummaryWhenAvailable() {
  const normalizer = new DoctorNormalizer();
  const summary = 'Dr. John C. Hawkins is a cardiologist in Macon, Georgia and is affiliated with multiple hospitals in the area, including Atrium Health Navicent Medical Center.';
  const profile = normalizer.normalize(
    {
      id: 'hawkins',
      firstName: 'John',
      lastName: 'Hawkins',
      stateCode: 'GA',
      healthgradesUrl: 'https://example.com/healthgrades',
      doximityUrl: 'https://example.com/doximity',
      usnewsUrl: 'https://example.com/usnews',
      vitalsUrl: 'https://example.com/vitals',
      npiUrl: 'https://example.com/npi',
    },
    [
      {
        name: 'NPI',
        status: '200',
        error: null,
        data: {
          name: 'John C Hawkins',
          credentials: 'M.D.',
          specialty: 'Internal Medicine, Cardiovascular Disease',
          city: 'Macon',
          state: 'GA',
        },
      },
      { name: 'Healthgrades', status: '200', error: null, data: {} },
      { name: 'Doximity', status: '200', error: null, data: {} },
      { name: 'US News', status: '200', error: null, data: { description: summary } },
      { name: 'Vitals', status: '403', error: 'Blocked', data: null },
    ]
  );

  assert.equal(profile.experience.summary, summary);
  assert.deepEqual(profile.experience.summarySource, { source: 'US News', url: 'https://example.com/usnews' });
}

function testNormalizerIgnoresZeroReviewRatings() {
  const normalizer = new DoctorNormalizer();
  const profile = normalizer.normalize(
    {
      id: 'golive',
      firstName: 'Anjani',
      lastName: 'Golive',
      stateCode: 'CA',
      healthgradesUrl: 'https://example.com/healthgrades',
      doximityUrl: 'https://example.com/doximity',
      usnewsUrl: 'https://example.com/usnews',
      vitalsUrl: 'https://example.com/vitals',
      npiUrl: 'https://example.com/npi',
    },
    [
      {
        name: 'NPI',
        status: '200',
        error: null,
        data: {
          name: 'Anjani Durga Golive',
          credentials: 'M.D.',
          specialty: 'Internal Medicine, Cardiovascular Disease',
          city: 'Modesto',
          state: 'CA',
        },
      },
      { name: 'Healthgrades', status: '200', error: null, data: { rating: 5, reviewCount: 1 } },
      { name: 'Doximity', status: '200', error: null, data: {} },
      { name: 'US News', status: 'error', error: 'Connection refused', data: null },
      { name: 'Vitals', status: '200', error: null, data: { rating: 4.2, reviewCount: 0 } },
    ]
  );

  assert.equal(profile.reviews.rating, 5);
  assert.equal(profile.reviews.reviewCount, 1);
  assert.deepEqual(profile.reviews.reviewSources, ['Healthgrades']);
  assert.deepEqual(profile.reviews.ratings.map(item => item.source), ['Healthgrades']);
}

function testNormalizerCollectsResearchPublications() {
  const normalizer = new DoctorNormalizer();
  const profile = normalizer.normalize(
    {
      id: 'golive',
      firstName: 'Anjani',
      lastName: 'Golive',
      stateCode: 'CA',
      healthgradesUrl: 'https://example.com/healthgrades',
      doximityUrl: 'https://example.com/doximity',
      usnewsUrl: 'https://example.com/usnews',
      vitalsUrl: 'https://example.com/vitals',
      npiUrl: 'https://example.com/npi',
    },
    [
      {
        name: 'NPI',
        status: '200',
        error: null,
        data: {
          name: 'Anjani Durga Golive',
          credentials: 'M.D.',
          specialty: 'Internal Medicine, Cardiovascular Disease',
          city: 'Modesto',
          state: 'CA',
        },
      },
      { name: 'Healthgrades', status: '200', error: null, data: {} },
      {
        name: 'Doximity',
        status: '200',
        error: null,
        data: {
          publications: [
            {
              title: 'Clinical outcomes in patients with atrial fibrillation receiving amiodarone on NOACs vs. warfarin.',
              authors: 'Ricardo Avendano, Anjani Golive',
              details: 'Ricardo Avendano, Anjani Golive | Journal of Interventional Cardiac Electrophysiology. 2019-01-01',
              type: 'PubMed',
            },
          ],
        },
      },
      { name: 'US News', status: 'error', error: 'Connection refused', data: null },
      { name: 'Vitals', status: '200', error: null, data: {} },
    ]
  );

  assert.equal(profile.research.publications.length, 1);
  assert.equal(profile.research.publications[0].source, 'Doximity');
  assert.equal(profile.research.publications[0].url, 'https://example.com/doximity');
}

testSpecialtyCoercion();
testProviderDataNormalization();
testErrorClassification();
testNormalizerMergesCaseStudyFields();
testNormalizerIgnoresZeroReviewRatings();
testNormalizerUsesUsNewsSummaryWhenAvailable();
testNormalizerCollectsResearchPublications();

console.log('All scraper tests passed');
