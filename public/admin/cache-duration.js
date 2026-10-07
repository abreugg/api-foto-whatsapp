/** UI-only conversion. The HTTP API and MySQL continue to store integer seconds. */
const CacheDuration = (() => {
  const units = { months: 2592000, days: 86400, hours: 3600, minutes: 60, seconds: 1 };
  const maxSeconds = 315360000;
  function toSeconds(value, unit) {
    if (value === '' || (typeof value === 'string' && !value.trim()) || !Object.hasOwn(units, unit))
      throw Error('Informe um tempo e selecione a unidade.');
    const seconds = Number(value) * units[unit];
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maxSeconds)
      throw Error('O prazo deve corresponder a segundos inteiros, de 0 até 10 anos.');
    return seconds;
  }
  function fromSeconds(seconds) {
    if (seconds === 0) return { value: 0, unit: 'hours' };
    for (const [unit, multiplier] of Object.entries(units))
      if (seconds % multiplier === 0) return { value: seconds / multiplier, unit };
    return { value: seconds, unit: 'seconds' };
  }
  return { toSeconds, fromSeconds, maxSeconds };
})();
