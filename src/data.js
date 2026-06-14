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

var WORKER = import.meta.env.VITE_WORKER_URL;

export async function loadData() {
  if (!WORKER) return { shots: SHOTS, cats: CATS };
  try {
    const { photos } = await (await fetch(WORKER + '/api/photos')).json();
    const shots = photos.map(p => ({
      id: p.id, cat: p.category, t: p.title, m: p.meta,
      ar: p.aspect_ratio, thumb: p.thumb_url, full: p.full_url
    }));
    return { shots, cats: CATS };
  } catch {
    return { shots: SHOTS, cats: CATS };
  }
}
