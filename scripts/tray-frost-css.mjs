/** Problems in production CSS for the practice tray frost. Empty means the blur survived. */
export function trayFrostProblems(css) {
  const problems = [];
  const rules = [
    ...css.matchAll(/(?:dialog\.)?\.practice-tray-panel:{1,2}before\{[^}]*\}/g),
  ].map((match) => match[0]);
  if (rules.length === 0) {
    problems.push(
      'built CSS has no practice-tray-panel::before rule for the tray frost',
    );
  } else {
    const frost = rules.some((rule) => {
      const body = rule.replace(/-webkit-backdrop-filter\s*:/gi, 'prefixed:');
      return /(?:^|[{;])\s*backdrop-filter\s*:\s*[^;]*\bblur\s*\(/i.test(body);
    });
    if (!frost) {
      problems.push(
        'built tray CSS lacks an unprefixed backdrop-filter with blur',
      );
    }
  }
  if (!/--tray-tint-solid\s*:\s*99%/.test(css)) {
    problems.push(
      'tray fallback tint must stay translucent at 99% on .practice-tray-root',
    );
  }
  if (/--tray-tint-solid\s*:\s*100%/.test(css)) {
    problems.push('tray fallback tint is fully opaque');
  }
  return problems;
}
