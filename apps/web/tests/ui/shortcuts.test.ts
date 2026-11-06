// @vitest-environment jsdom
/**
 * The keyboard shortcuts' pure parts (PLAN §12.5, chunk 9.3, `ui/shortcuts.ts`): the key map (any
 * layout, no modifiers, no repeats but ↑/↓), the focus rules (never in a text field, a dialog or a
 * sheet), and what each key does to Row A and the tray in every §12.7 spot: only what the view
 * offers from `legalActions`, never an amount of its own (pitfall 1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionBarView,
  snapAmount,
  stepAmount,
  type ActionBarInput,
  type ActionBarView,
} from '../../src/ui/actionBar.ts';
import { ACTION_SPOTS } from '../../src/ui/dev/actionFixtures.ts';
import {
  isTyping,
  keysBlocked,
  ownsEnter,
  rowMove,
  shortcutOf,
  type KeyLike,
  type Shortcut,
} from '../../src/ui/shortcuts.ts';

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  ...over,
});

const viewOf = (spot: keyof typeof ACTION_SPOTS): ActionBarView =>
  actionBarView({ ...(ACTION_SPOTS[spot] as Omit<ActionBarInput, 'amounts'>), amounts: 'chips' });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shortcutOf (§12.5)', () => {
  it('maps the §12.5 keys, letters in either case', () => {
    const map: [string, Shortcut][] = [
      ['f', 'fold'],
      ['F', 'fold'],
      ['c', 'call'],
      ['b', 'raise'],
      ['R', 'raise'],
      ['1', 'preset1'],
      ['5', 'preset5'],
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['Enter', 'confirm'],
      ['u', 'undo'],
      ['h', 'hint'],
      ['K', 'hands'],
      ['?', 'help'],
    ];
    for (const [k, s] of map) expect(shortcutOf(key(k)), k).toBe(s);
    for (const k of ['6', '0', 'x', 'Escape', ' ', 'Tab', 'ArrowLeft', '/', 'Shift']) {
      expect(shortcutOf(key(k)), k).toBeNull();
    }
  });

  it('never with Ctrl, Alt or Meta, never while composing; held keys repeat only ↑/↓', () => {
    expect(shortcutOf(key('c', { ctrlKey: true }))).toBeNull(); // Copy
    expect(shortcutOf(key('r', { metaKey: true }))).toBeNull(); // Reload
    expect(shortcutOf(key('f', { altKey: true }))).toBeNull();
    expect(shortcutOf(key('c', { isComposing: true }))).toBeNull();
    expect(shortcutOf(key('c', { repeat: true }))).toBeNull();
    expect(shortcutOf(key('Enter', { repeat: true }))).toBeNull();
    expect(shortcutOf(key('ArrowUp', { repeat: true }))).toBe('up');
    expect(shortcutOf(key('ArrowDown', { repeat: true }))).toBe('down');
    // Shift is how "?" (and capitals) are typed.
    expect(shortcutOf(key('?'))).toBe('help');
  });

  it('another alphabet, or digits behind Shift: the physical key', () => {
    expect(shortcutOf(key('а', { code: 'KeyF' }))).toBe('fold'); // Cyrillic layout
    expect(shortcutOf(key('с', { code: 'KeyC' }))).toBe('call');
    expect(shortcutOf(key('к', { code: 'KeyR' }))).toBe('raise');
    expect(shortcutOf(key('&', { code: 'Digit1' }))).toBe('preset1'); // AZERTY
    expect(shortcutOf(key('3', { code: 'Numpad3' }))).toBe('preset3');
    // ASCII punctuation never moves onto a letter's shortcut (AZERTY's ";" sits on KeyM, etc.).
    expect(shortcutOf(key(';', { code: 'KeyF' }))).toBeNull();
    expect(shortcutOf(key('ф', { code: 'KeyA' }))).toBeNull();
  });
});

describe('focus rules (§12.5: never while typing, nor in a dialog or a sheet)', () => {
  const add = (html: string): HTMLElement => {
    document.body.insertAdjacentHTML('beforeend', html);
    return document.body.lastElementChild as HTMLElement;
  };
  const event = (target: EventTarget | null, defaultPrevented = false) => ({
    target,
    defaultPrevented,
  });

  it('text fields type; the slider, buttons and checkboxes do not', () => {
    expect(isTyping(add('<input type="text">'))).toBe(true);
    expect(isTyping(add('<input>'))).toBe(true);
    expect(isTyping(add('<input type="number">'))).toBe(true);
    expect(isTyping(add('<textarea></textarea>'))).toBe(true);
    expect(isTyping(add('<select><option>a</option></select>'))).toBe(true);
    const editable = add('<div contenteditable="true"></div>');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTyping(editable)).toBe(true);
    expect(isTyping(add('<input type="range">'))).toBe(false);
    expect(isTyping(add('<input type="checkbox">'))).toBe(false);
    expect(isTyping(add('<button>Call</button>'))).toBe(false);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('blocked in a field, inside a dialog, while a modal layer is open, or when taken', () => {
    const page = add('<h1 tabindex="-1">Poker table</h1>');
    expect(keysBlocked(event(page))).toBe(false);
    expect(keysBlocked(event(page, true))).toBe(true);
    expect(keysBlocked(event(add('<input aria-label="amount">')))).toBe(true);
    const dialog = add('<div role="dialog"><button>Close</button></div>');
    expect(keysBlocked(event(dialog.querySelector('button')))).toBe(true);
    dialog.remove();
    // A modal layer open elsewhere (focus on the page behind it) blocks too…
    const sheet = add('<div><div role="dialog" aria-modal="true"></div></div>');
    expect(keysBlocked(event(page))).toBe(true);
    // …but not one that is sliding out (the rankings drawer is `inert` while it closes).
    sheet.setAttribute('inert', '');
    expect(keysBlocked(event(page))).toBe(false);
    // A first-table tip is not a dialog: keys still work while it shows.
    add('<div role="status" data-tip="heroStrip">This is your hand.</div>');
    expect(keysBlocked(event(page))).toBe(false);
  });

  it('Enter belongs to a focused control; on the page or the slider it confirms', () => {
    expect(ownsEnter(add('<button>Call 40</button>'))).toBe(true);
    expect(ownsEnter(add('<a href="#x">x</a>'))).toBe(true);
    expect(ownsEnter(add('<input type="text">'))).toBe(true);
    expect(ownsEnter(add('<div role="button"><span>x</span></div>').querySelector('span'))).toBe(
      true,
    );
    expect(ownsEnter(add('<input type="range">'))).toBe(false);
    expect(ownsEnter(document.body)).toBe(false);
    expect(ownsEnter(null)).toBe(false);
  });
});

describe('rowMove: Row A and the tray, only what the view offers (§12.7, pitfall 1)', () => {
  it('F, C, B/R press the three buttons; the button itself decides (a disabled one says why)', () => {
    const v = viewOf('check');
    expect(rowMove('fold', v, false, 0, false)).toEqual({ kind: 'press', slot: 'fold' });
    expect(v.fold.enabled).toBe(false); // checking is free: the press shows the note, no action
    expect(rowMove('call', v, false, 0, false)).toEqual({ kind: 'press', slot: 'middle' });
    expect(rowMove('raise', v, false, 0, false)).toEqual({ kind: 'press', slot: 'right' });
    // No right button (a call that puts the hero all-in): R does nothing.
    const short = viewOf('shortCall');
    expect(short.right).toBeNull();
    expect(rowMove('raise', short, false, 0, false)).toBeNull();
    // Raise not reopened: the press shows its note; only-all-in: one press acts.
    expect(rowMove('raise', viewOf('notReopened'), false, 0, false)).toEqual({
      kind: 'press',
      slot: 'right',
    });
    expect(viewOf('notReopened').right?.enabled).toBe(false);
    expect(viewOf('allInOnly').right?.opensTray).toBe(false);
  });

  it('1–5 choose an enabled preset (opening the tray); out-of-range ones and missing ones do nothing', () => {
    const v = viewOf('facing');
    const tray = v.tray;
    if (tray === null) throw new Error('no tray');
    tray.presets.forEach((p, i) => {
      const k = `preset${i + 1}` as Shortcut;
      if (i >= 5) return;
      const closed = rowMove(k, v, false, tray.start, false);
      const open = rowMove(k, v, true, tray.start, false);
      if (!p.enabled) {
        expect(closed).toBeNull();
        expect(open).toBeNull();
        return;
      }
      expect(closed).toEqual({ kind: 'amount', amount: p.amount, open: true });
      expect(open).toEqual({ kind: 'amount', amount: p.amount, open: false });
      expect(p.amount).toBeGreaterThanOrEqual(tray.min);
      expect(p.amount).toBeLessThanOrEqual(tray.max);
    });
    const missing = `preset${Math.min(5, tray.presets.length + 1)}` as Shortcut;
    if (tray.presets.length < 5) expect(rowMove(missing, v, true, tray.start, false)).toBeNull();
    // No tray (a call, waiting, the quiz's locked bar): no presets.
    expect(rowMove('preset1', viewOf('shortCall'), false, 0, false)).toBeNull();
    expect(rowMove('preset1', viewOf('waiting'), false, 0, false)).toBeNull();
    expect(rowMove('preset1', viewOf('notReopened'), false, 0, false)).toBeNull();
  });

  it('↑/↓ step the open tray inside the legal bounds; nothing at the ends or with it closed', () => {
    const v = viewOf('check');
    const tray = v.tray;
    if (tray === null) throw new Error('no tray');
    const from = tray.start;
    expect(rowMove('up', v, true, from, false)).toEqual({
      kind: 'amount',
      amount: stepAmount(tray, from, 1),
      open: false,
    });
    expect(rowMove('down', v, true, from, false)).toEqual({
      kind: 'amount',
      amount: stepAmount(tray, from, -1),
      open: false,
    });
    expect(rowMove('up', v, true, tray.max, false)).toBeNull();
    expect(rowMove('down', v, true, tray.min, false)).toBeNull();
    expect(rowMove('up', v, false, from, false)).toBeNull();
    // An odd amount (typed, or the coach's) steps from its legal snap.
    const odd = tray.min + 3;
    expect(rowMove('up', v, true, odd, false)).toEqual({
      kind: 'amount',
      amount: stepAmount(tray, snapAmount(odd, tray), 1),
      open: false,
    });
  });

  it('Enter confirms the open tray unless a focused control owns it; else nothing', () => {
    const v = viewOf('facing');
    expect(rowMove('confirm', v, true, 240, false)).toEqual({ kind: 'press', slot: 'right' });
    expect(rowMove('confirm', v, true, 240, true)).toBeNull();
    expect(rowMove('confirm', v, false, 240, false)).toBeNull();
  });

  it('while waiting, the presses reach disabled buttons (nothing is sent) and the tray keys do nothing', () => {
    const v = viewOf('waiting');
    expect(v.waiting).toBe(true);
    expect([v.fold.enabled, v.middle.enabled, v.right?.enabled]).toEqual([false, false, false]);
    expect(rowMove('up', v, true, 100, false)).toBeNull();
    expect(rowMove('confirm', v, true, 100, false)).toBeNull();
  });

  it('U, H, K and ? are not Row A keys', () => {
    for (const k of ['undo', 'hint', 'hands', 'help'] as const) {
      expect(rowMove(k, viewOf('facing'), true, 240, false)).toBeNull();
    }
  });
});
