export const core = {
  sites: { FL: 'https://example.invalid/fl', GA: 'https://example.invalid/ga', AL: 'https://example.invalid/al', CA: 'https://example.invalid/ca' },
  races: [
    'S|FL-sp|Red Senator|R|3|R:Red Senator *#S-TEST~50~Biography;D:Blue Senator#D-TEST;I:Independent Senator',
    'S|GA|Blue Georgia|D|3|R!:Red Georgia;D:Blue Georgia *',
    'H|AL-01|Red House|R|2|R:Red House *;D:Blue House',
    'H|CA-AL|Independent House|I|3|I:Independent House *;D:Blue California;R:Red California',
    'G|FL|Governor|R|3|R:Red Governor;D:Blue Governor',
  ].join('\n'),
};

export const emptyResults = { generated_at: '2026-11-04T01:00:00Z', races: {}, states: {} };
export const emptyLive = { at: '2026-11-04T01:01:00Z', res: {}, st: {} };
export const countingFlorida = {
  status: 'counting', votes: 1000, asof: '2026-11-04T01:00:00Z',
  cands: [ { name: 'Red Senator', party: 'R', votes: 510, pct: 51 },
    { name: 'Blue Senator', party: 'D', votes: 490, pct: 49 } ],
  src: 'Test election office', url: 'https://example.invalid/results',
};
export const calledFlorida = {
  ...countingFlorida, status: 'called', leader: 'R', winner_name: 'Red Senator', called_by: 'AP',
};

export function copy(value) { return structuredClone(value); }
