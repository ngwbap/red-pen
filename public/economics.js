// The numbers behind the red pen. Shared by the server and the browser so the
// figures a judge sees can be recomputed live when an assumption is edited.
// The model only classifies tasks and estimates their share of the week; every
// euro and hour below is plain arithmetic on top of that.

export const DEFAULTS = {
  hoursPerYear: 1600,   // productive hours of a Finnish full-time role after holidays
  salaryMonths: 12.5,   // 12 months + holiday bonus (lomaraha)
  sideCosts: 0.22,      // employer contributions on top of gross salary
  rates: { automate: 0.8, assist: 0.4, human: 0 }, // share of a task's time actually freed
};

export function computeEconomics(lines = [], assumptions = {}) {
  const a = { ...DEFAULTS, ...assumptions, rates: { ...DEFAULTS.rates, ...(assumptions.rates || {}) } };
  const tasks = lines.filter((l) => l.kind === 'task' && a.rates[l.verdict] !== undefined);
  const total = tasks.reduce((s, l) => s + Math.max(0, Number(l.time_share) || 0), 0);

  const mix = { automate: 0, assist: 0, human: 0 };
  let share = 0;
  for (const l of tasks) {
    const w = total ? Math.max(0, Number(l.time_share) || 0) / total : 1 / tasks.length;
    mix[l.verdict] += w;
    share += w * a.rates[l.verdict];
  }

  const monthly = Number(a.monthlySalary) || 0;
  const annualCost = monthly * a.salaryMonths * (1 + a.sideCosts);
  const hours = share * a.hoursPerYear;
  const eur = share * annualCost;
  // If the freed time goes back into the human part of the job, this is how much
  // more of the week the hire spends on the work they were hired for.
  const multiplier = share < 0.95 ? 1 / (1 - share) : 20;

  const countBy = (v) => tasks.filter((l) => l.verdict === v).length;
  const signal = tasks.length < 2 ? 'none' : share < 0.15 ? 'weak' : 'strong';

  return {
    assumptions: a,
    taskCount: tasks.length,
    counts: { automate: countBy('automate'), assist: countBy('assist'), human: countBy('human') },
    mix,
    share,
    percent: Math.round(share * 100),
    annualCost,
    hours,
    eur,
    multiplier,
    signal,
    rounded: { hours: roundTo(hours, hours >= 200 ? 50 : 10), eur: roundTo(eur, eur >= 10000 ? 1000 : 100) },
    display: {
      percent: `${Math.round(share * 100)}%`,
      hours: `${roundTo(hours, hours >= 200 ? 50 : 10).toLocaleString('en-US')} h`,
      eur: `€${roundTo(eur, eur >= 10000 ? 1000 : 100).toLocaleString('en-US')}`,
      multiplier: `${multiplier >= 10 ? Math.round(multiplier) : multiplier.toFixed(1)}×`,
    },
  };
}

// The model writes the email with {{placeholders}} so it never invents numbers.
export function fillTemplate(text = '', econ, lang = 'en') {
  const fi = lang === 'fi';
  const num = (n) => n.toLocaleString(fi ? 'fi-FI' : 'en-US');
  return text
    .replaceAll('{{percent}}', fi ? `${econ.percent} %` : econ.display.percent)
    .replaceAll('{{hours}}', num(econ.rounded.hours))
    .replaceAll('{{eur}}', fi ? `${num(econ.rounded.eur)} €` : econ.display.eur)
    .replaceAll('{{multiplier}}', econ.display.multiplier);
}

function roundTo(n, step) {
  return Math.round(n / step) * step;
}
