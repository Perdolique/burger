export function validPayload(value) {
  return value?.schemaVersion === 1 && Array.isArray(value.races) &&
    ['S', 'H'].every(office => Number.isInteger(value.chambers?.[office]?.total) && value.chambers[office].seats);
}

export function mergeCachedResults(next, previous) {
  if (!previous) return next;
  const oldRaces = new Map(previous.races.map(race => [race.id, race]));
  let retainedCalls = false;
  const races = next.races.map(race => {
    const old = oldRaces.get(race.id);
    if (!old || (!old.reported && old.status !== 'called')) return race;
    const missingCall = next.callsAvailable === false && old.status === 'called' && race.status !== 'called';
    const missingResult = race.resultAvailable === false && !race.reported && race.status !== 'called';
    const olderCount = race.status !== 'called' &&
      Date.parse(race.asOf ?? '') < Date.parse(old.asOf ?? '');
    if (!missingCall && !missingResult && !olderCount) return race;
    if (old.status === 'called') retainedCalls = true;
    return { ...old, sourceStale: true, resultAvailable: false, feedError: race.feedError };
  });
  const chambers = Object.fromEntries(['S', 'H'].map(office => {
    const seats = { D: 0, R: 0, O: 0 };
    for (const race of races) if (race.office === office && race.status === 'called') seats[race.winnerParty]++;
    return [office, { ...next.chambers[office], seats, called: seats.D + seats.R + seats.O }];
  }));
  const restoredCalls = next.callsAvailable === false && previous.callsAvailable !== false;
  return { ...next, races, chambers,
    callsAvailable: restoredCalls ? true : next.callsAvailable,
    callsStale: Boolean(next.callsStale || restoredCalls || retainedCalls),
  };
}
