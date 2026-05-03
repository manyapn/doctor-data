'use strict';

const SOURCE_ORDER = ['NPI', 'Healthgrades', 'Doximity', 'US News', 'Vitals'];
const REVIEW_SOURCES = ['Healthgrades', 'US News', 'Vitals'];
const EXPERIENCE_SOURCES = ['Doximity', 'Healthgrades', 'US News', 'Vitals'];

const SOURCE_COLORS = {
  NPI: '#8b5cf6',
  Healthgrades: '#f59e0b',
  Doximity: '#3b82f6',
  'US News': '#0d9488',
  Vitals: '#ef4444',
};

const DOCTOR_CONFIGS = [
  {
    id: 'golive',
    firstName: 'Anjani',
    lastName: 'Golive',
    stateCode: 'CA',
    healthgradesUrl: 'https://www.healthgrades.com/physician/dr-anjani-golive-w3pdv',
    doximityUrl: 'https://www.doximity.com/pub/anjani-golive-md',
    usnewsUrl: 'https://health.usnews.com/doctors/anjani-golive-871683',
    vitalsUrl: 'https://www.vitals.com/doctors/Dr_Anjani_Golive.html',
    npiUrl: 'https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=Anjani&last_name=Golive&state=CA&limit=1',
  },
  {
    id: 'marin',
    firstName: 'Jose',
    lastName: 'Marin',
    stateCode: 'TX',
    healthgradesUrl: 'https://www.healthgrades.com/physician/dr-jose-marin-ci8fz',
    doximityUrl: 'https://www.doximity.com/pub/jose-marin-md-151e',
    usnewsUrl: 'https://health.usnews.com/doctors/jose-marin-1010190',
    vitalsUrl: 'https://www.vitals.com/doctors/Dr_Jose_Marin.html',
    npiUrl: 'https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=Jose&last_name=Marin&state=TX&limit=1',
  },
  {
    id: 'hawkins',
    firstName: 'John',
    lastName: 'Hawkins',
    stateCode: 'GA',
    healthgradesUrl: 'https://www.healthgrades.com/physician/dr-john-hawkins-3gjyk',
    doximityUrl: 'https://www.doximity.com/pub/john-hawkins-md-bb98194d',
    usnewsUrl: 'https://health.usnews.com/doctors/john-hawkins-402774',
    vitalsUrl: 'https://www.vitals.com/doctors/Dr_John_C_Hawkins.html',
    npiUrl: 'https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=John&last_name=Hawkins&state=GA&city=Macon&limit=1',
  },
];

module.exports = {
  DOCTOR_CONFIGS,
  EXPERIENCE_SOURCES,
  REVIEW_SOURCES,
  SOURCE_COLORS,
  SOURCE_ORDER,
};
