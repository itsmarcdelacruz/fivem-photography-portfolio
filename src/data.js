export var CATS = [
  { id: 'all',       label: 'All' },
  { id: 'portraits', label: 'Portraits' },
  { id: 'vehicles',  label: 'Vehicles' },
  { id: 'city',      label: 'Cityscapes' },
  { id: 'action',    label: 'Action' },
  { id: 'nightlife', label: 'Nightlife' },
  { id: 'crew',      label: 'Crew' }
];

export var SHOTS = [
  { cat:'portraits', t:'Smoke Break',        m:'f/1.8 · 35mm · golden hour', ar:'4/5'   },
  { cat:'nightlife', t:'Neon & Rain',        m:'f/2.0 · ISO 800 · bloom',    ar:'16/10' },
  { cat:'vehicles',  t:'Banshee at Dusk',    m:'f/4.0 · 50mm · long expo',   ar:'4/3'   },
  { cat:'city',      t:'Vinewood Skyline',   m:'f/8.0 · 24mm · LUT 03',      ar:'3/4'   },
  { cat:'action',    t:'Pursuit, 3AM',       m:'f/2.8 · 1/500 · grain',      ar:'16/9'  },
  { cat:'crew',      t:'The Family',         m:'f/2.2 · 40mm · ambient',     ar:'4/5'   },
  { cat:'portraits', t:'Femme Fatale',       m:'f/1.4 · 85mm · soft key',    ar:'1/1'   },
  { cat:'nightlife', t:'Last Call',          m:'f/1.8 · ISO 1600 · neon',    ar:'4/5'   },
  { cat:'vehicles',  t:'Lowrider Sunset',    m:'f/5.6 · 35mm · warm grade',  ar:'16/9'  },
  { cat:'city',      t:'Under the Overpass', m:'f/7.1 · 28mm · fog',         ar:'4/3'   },
  { cat:'action',    t:'Standoff',           m:'f/2.0 · 1/250 · tension',    ar:'3/4'   },
  { cat:'crew',      t:'Garage Nights',      m:'f/2.5 · 35mm · sodium',      ar:'16/10' },
  { cat:'nightlife', t:'Strip Lights',       m:'f/1.6 · ISO 1250 · halation', ar:'1/1'  },
  { cat:'portraits', t:'Quiet Confidence',   m:'f/2.0 · 85mm · rim light',   ar:'4/5'   }
];

const DEFAULT_WORKER = import.meta.env.VITE_WORKER_URL || '';

function mapPhoto(photo) {
  return {
    id: photo.id,
    cat: photo.category,
    t: photo.title,
    m: photo.meta,
    ar: photo.aspect_ratio,
    thumb: photo.thumb_url,
    full: photo.full_url,
    alt: photo.alt_text,
    collection_ids: photo.collection_ids || []
  };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Request failed with status ' + response.status);
  return response.json();
}

export async function loadPortfolio({ workerUrl = DEFAULT_WORKER } = {}) {
  if (!workerUrl) return { shots: SHOTS, cats: CATS, collections: [], source: 'local' };
  const [{ photos }, { collections }] = await Promise.all([
    getJson(workerUrl + '/api/photos'),
    getJson(workerUrl + '/api/collections')
  ]);
  return {
    shots: photos.map(mapPhoto),
    cats: CATS,
    collections,
    source: 'remote'
  };
}

export async function loadStory(slug, { workerUrl = DEFAULT_WORKER } = {}) {
  if (!workerUrl) throw new Error('Story routes require VITE_WORKER_URL');
  return (await getJson(workerUrl + '/api/collections/' + encodeURIComponent(slug))).collection;
}

export const loadData = loadPortfolio;
