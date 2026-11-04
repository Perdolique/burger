export function validPayload(value) {
  return value?.schemaVersion === 1 && Array.isArray(value.races) &&
    ['S', 'H'].every(office => Number.isInteger(value.chambers?.[office]?.total) && value.chambers[office].seats);
}

function callsKnown(data, office) {
  return data.chambers[office].callsAvailable ?? data.callsAvailable !== false;
}

export function mergeCachedResults(next, previous) {
  if (!previous) return next;
  const oldRaces = new Map(previous.races.map(race => [race.id, race]));
  const retainedOffices = new Set();
  const races = next.races.map(race => {
    const old = oldRaces.get(race.id);
    if (!old || (!old.reported && old.status !== 'called')) return race;
    const missingCall = !callsKnown(next, race.office) && old.status === 'called' && race.status !== 'called';
    const missingResult = race.resultAvailable === false && !race.reported && race.status !== 'called';
    const olderResult = Date.parse(race.asOf ?? '') < Date.parse(old.asOf ?? '');
    if (!missingCall && !missingResult && !olderResult) return race;
    retainedOffices.add(race.office);
    return { ...old, sourceStale: true, resultAvailable: false, feedError: race.feedError };
  });
  // A cold server may have fetched only one chamber. Restore the missing one from OBS storage.
  const ids = new Set(races.map(race => race.id));
  for (const old of previous.races) {
    if (!ids.has(old.id) && !callsKnown(next, old.office)) {
      retainedOffices.add(old.office);
      races.push({ ...old, sourceStale: true, resultAvailable: false, feedError: true });
    }
  }
  const chambers = Object.fromEntries(['S', 'H'].map(office => {
    const seats = { D: 0, R: 0, O: 0 };
    for (const race of races) if (race.office === office && race.status === 'called') seats[race.winnerParty]++;
    const restored = !callsKnown(next, office) && callsKnown(previous, office);
    return [office, { ...next.chambers[office], seats, called: seats.D + seats.R + seats.O,
      callsAvailable: callsKnown(next, office) || restored,
      callsStale: Boolean(next.chambers[office].callsStale ?? next.callsStale) || restored || retainedOffices.has(office),
    }];
  }));
  return { ...next, races, chambers,
    callsAvailable: ['S', 'H'].every(office => chambers[office].callsAvailable),
    callsStale: ['S', 'H'].some(office => chambers[office].callsStale),
  };
}
