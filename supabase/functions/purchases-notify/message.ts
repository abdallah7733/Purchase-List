// Turns one person's recent activity rows into a single notification, e.g.
//   "Mohammed added 3 items to your purchase list" / "Cumin 5 g, Black pepper 50 g, Bay leaves 20 g. Tap to check it out."
// Pure function so it can be tested without a database.

export type Amount = { qty: number; unit: string } | null;
export type Activity = {
  id: number;
  kind: "save" | "add_item" | "reset";
  day: string | null;
  details: {
    changes?: { item_id: string; from: Amount; to: Amount }[];
    name?: string;
    days?: number;
  };
};

const MAX_NAMES = 3;

export function fmt(q: number) {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
const amount = (a: NonNullable<Amount>) => `${fmt(Number(a.qty))} ${a.unit}`;
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w + "s"}`;
const listOf = (xs: string[]) => xs.slice(0, MAX_NAMES).join(", ") + (xs.length > MAX_NAMES ? ` +${xs.length - MAX_NAMES} more` : "");

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w]} ${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

export function buildMessage(who: string | null, rows: Activity[], names: Map<string, string>, today: string) {
  const name = (id: string) => names.get(id) ?? id;
  const by = who || "Someone";

  // Net effect per day + item across all saves: first "from", last "to". Rapid edits collapse into one change.
  const net = new Map<string, Map<string, { from: Amount; to: Amount }>>();
  const catalog: string[] = [];
  let resetDays: number | null = null;
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (r.kind === "save" && r.day) {
      const m = net.get(r.day) ?? new Map();
      net.set(r.day, m);
      for (const c of r.details.changes ?? []) {
        const prev = m.get(c.item_id);
        m.set(c.item_id, { from: prev ? prev.from : c.from, to: c.to });
      }
    } else if (r.kind === "add_item" && r.details.name) catalog.push(r.details.name);
    else if (r.kind === "reset") resetDays = (resetDays ?? 0) + Number(r.details.days ?? 0);
  }

  let added = 0, changed = 0, removed = 0;
  const lines: string[] = [];
  for (const day of [...net.keys()].sort()) {
    const a: string[] = [], c: string[] = [], x: string[] = [];
    for (const [id, { from, to }] of net.get(day)!) {
      if (from && to && Number(from.qty) === Number(to.qty) && from.unit === to.unit) continue;
      if (!from && to) a.push(`${name(id)} ${amount(to)}`);
      else if (from && !to) x.push(name(id));
      else if (from && to) c.push(`${name(id)} ${from.unit === to.unit ? `${fmt(Number(from.qty))} → ${amount(to)}` : `${amount(from)} → ${amount(to)}`}`);
    }
    added += a.length; changed += c.length; removed += x.length;
    const parts: string[] = [];
    const kinds = [a.length, c.length, x.length].filter(Boolean).length;
    // With one kind of change the title already says "added" / "changed" / "removed", so the body is just the items.
    const say = (verb: string, xs: string[]) => (kinds === 1 && net.size === 1 ? "" : verb + " ") + listOf(xs);
    if (a.length) parts.push(say("Added", a));
    if (c.length) parts.push(say("Changed", c));
    if (x.length) parts.push(say("Removed", x));
    if (parts.length) lines.push((day === today ? "" : `${dayLabel(day)}: `) + parts.join(". "));
  }
  if (catalog.length) lines.push(`New in the catalog: ${listOf(catalog)}`);
  if (resetDays !== null) lines.push(`${plural(resetDays, "saved day")} cleared`);
  if (!lines.length) return null;

  let title: string;
  const listKinds = [added, changed, removed].filter(Boolean).length;
  if (resetDays !== null) title = `${by} reset the purchase history`;
  else if (listKinds === 0) title = `${by} added ${plural(catalog.length, "new item")} to the catalog`;
  else if (listKinds > 1) title = `${by} updated your purchase list`;
  else if (added) title = `${by} added ${plural(added, "item")} to your purchase list`;
  else if (changed) title = `${by} changed ${plural(changed, "item")} on your purchase list`;
  else title = `${by} removed ${plural(removed, "item")} from your purchase list`;

  return { title, body: `${lines.join(". ")}. Tap to check it out.` };
}
