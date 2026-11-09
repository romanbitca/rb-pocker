/**
 * The leak rules of PLAN §19.9 as a checker of one message to one player. It walks the JSON
 * structure and looks at keys and whole values; it never searches strings for numbers, because card
 * numbers are everywhere.
 */

/** L3, and the fields only a `HandState` or a `TableState` has. */
const FORBIDDEN_KEYS = new Set([
  // L3, by name
  'deck',
  'deckPos',
  'seed',
  'tableSeed',
  'startTotal',
  // HandState and TableState
  'schema',
  'engineVersion',
  'tableId',
  'slots',
  'lastAggressor',
  'preflopAggressor',
  'undoneDecisions',
  'lastActedAtBet',
  'nextHandSeq',
  'handsDealt',
  'personalityCursor',
  'nameCursor',
  'reloads',
  // L5: anything naming a person other than `name`
  'id',
  'userId',
  'telegramId',
  'username',
  'first_name',
  'last_name',
  'language_code',
  'photo_url',
  'photo',
  'initData',
]);

/** A seed as the engine writes it (L6). */
const SEED_SHAPE = /^[0-9a-f]{32}$/;

export interface LeakRules {
  /** Every Telegram id that exists in this test: no number and no string may contain one. */
  readonly ids: readonly number[];
  /** Usernames and photo URLs known to the test: no string may contain one. */
  readonly secrets?: readonly string[];
  /** The only names a seat may show. */
  readonly names: ReadonlySet<string>;
  /** The seeds the server drew, when the test knows them. */
  readonly seeds?: readonly string[];
}

interface Seat {
  name?: unknown;
}
interface HandSeat {
  hole: unknown;
  folded: boolean;
}
interface Hand {
  seats: HandSeat[];
  revealed: number[];
}
interface Legal {
  seat: number;
}
interface View {
  you: number;
  seats: (Seat | null)[];
  hand: Hand | null;
  decision: { seat: number } | null;
  legal: Legal | null;
}

function walk(node: unknown, path: string, rules: LeakRules, problems: string[]): void {
  if (typeof node === 'number') {
    if (rules.ids.includes(node)) problems.push(`L5: ${path} is a Telegram id`);
    return;
  }
  if (typeof node === 'string') {
    if (SEED_SHAPE.test(node)) problems.push(`L6: ${path} looks like a seed`);
    if (rules.seeds?.includes(node) === true) problems.push(`L6: ${path} is a seed`);
    for (const id of rules.ids) {
      if (node.includes(String(id))) problems.push(`L5: ${path} holds a Telegram id`);
    }
    for (const secret of rules.secrets ?? []) {
      if (node.includes(secret)) problems.push(`L5: ${path} holds "${secret}"`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      walk(item, `${path}[${i}]`, rules, problems);
    });
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.has(key)) problems.push(`L3/L5: key "${key}" at ${path}`);
      walk(value, `${path}.${key}`, rules, problems);
    }
  }
}

function checkView(view: View, rules: LeakRules, problems: string[]): void {
  const you = view.you;
  const hand = view.hand;
  if (hand !== null) {
    hand.seats.forEach((seat, i) => {
      if (seat.hole !== null && i !== you && !hand.revealed.includes(i)) {
        problems.push(`L2: the hidden cards of seat ${i} went to seat ${you}`);
      }
    });
    for (const seat of hand.revealed) {
      if (hand.seats[seat]?.folded !== false) {
        problems.push(`L2: seat ${seat} is revealed but not live`);
      }
    }
  }
  if (view.legal !== null && (view.decision?.seat !== you || view.legal.seat !== you)) {
    problems.push(`L4: legal for seat ${view.legal.seat} went to seat ${you}`);
  }
  view.seats.forEach((seat, i) => {
    if (seat !== null && !rules.names.has(String(seat.name))) {
      problems.push(`L5: seat ${i} shows the name "${String(seat.name)}"`);
    }
  });
}

/**
 * Everything wrong with this frame, as it went on the wire; empty when it passes L2–L6. L1 needs
 * the server's hand as well, so `room.leak.test.ts` checks it by itself.
 */
export function leakProblems(frame: unknown, rules: LeakRules): string[] {
  const msg = JSON.parse(JSON.stringify(frame)) as { t: string; view?: View };
  const problems: string[] = [];
  walk(msg, 'msg', rules, problems);
  if (msg.t === 'table' && msg.view !== undefined) checkView(msg.view, rules, problems);
  return problems;
}
