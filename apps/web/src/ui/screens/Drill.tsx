/**
 * The hand drill's page (PLAN §13.5): the owner's Poker Hand Drill, ported. The counters (streak,
 * score, best), the game button (game and difficulty), All hands and Stats; then the question,
 * its feedback with the reason, and the pickers. A lazy chunk: `screensEntry.tsx` draws the frame
 * (Back and the title) and passes in the drill's logic (`logic`, `app/drill.ts`) and the Table's
 * rankings drawer.
 *
 * - Sheets: the game sheet and the stats sheet are the `drillGames` and `drillStats` overlays,
 *   All hands the `rankings` overlay (the Table's own drawer, `RankingsDrawer`, marking the hands
 *   of the answered question "This round"): Android Back closes the top one first, then leaves
 *   the page (§12.1).
 * - Keyboard: 1–9 and 0 (10) pick a position or an option, A, B and T the hands of Which wins,
 *   Enter or Space the next question, H All hands. After an answer the focus moves to Next; after
 *   Next, to the new question's prompt.
 * - Motion: the deal, the exit, the counters' pop, the feedback and the chip burst at streak
 *   milestones are CSS animations, all off under reduced motion (`data-motion`, §12.8).
 * - Cards are RB's `Card` (SVG suits, the four-colour setting); after the answer the five that
 *   count have the §6.1 gold edge, the cards that make the hand raised too; nothing is faded.
 * - Styles: inline (`drillStyles.ts`), shared classes, and `Drill.module.css` for what needs CSS
 *   (the one stylesheet is loaded at first paint, §15.3).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type Ref,
} from 'react';
import type { DrillView } from '../../app/drill.ts';
import { useOverlay, type DrillModule } from '../../app/store.ts';
import type { Card as CardValue } from '../../core/cards.ts';
import { RANKINGS } from '../../data/rankings.ts';
import type { HandFacts } from '../../drill/explain.ts';
import type { Position } from '../../drill/ladder.ts';
import { drillWords as W } from '../../i18n/drill.ts';
import { Card } from '../components/Card.tsx';
import levels from '../components/Levels.module.css';
import type { RankingsDrawerProps } from '../components/RankingsDrawer.tsx';
import { ICONS, SpriteIcon } from '../components/SvgSprite.tsx';
import { answerLines, hintOf, nameAt, optionLabel, promptOf } from '../drillText.ts';
import s from './Drill.module.css';
import { GamesSheet, StatsSheet } from './DrillSheets.tsx';
import * as css from './drillStyles.ts';
import { CheckIcon, ChevronDownIcon } from './icons.tsx';
import screen from './Screen.module.css';

const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');

/** The exit animation before the next question (ms, as in `Drill.module.css`). */
const LEAVE_MS = 170;
/** The deal: each card starts this much after the one before it (ms). */
const DEAL_STAGGER_MS = 55;

/** Reduced motion: the setting, else the system's choice (§12.8, `data-motion` on the root). */
export function motionReduced(): boolean {
  const setting = document.documentElement.dataset.motion;
  if (setting === 'reduced') return true;
  if (setting === 'full') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** The names in alphabetical order, so the order gives nothing away. */
const BY_NAME: readonly Position[] = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as Position[]).sort((a, b) =>
  nameAt(a).localeCompare(nameAt(b), 'en'),
);

/** How a choice looks: picked before the answer, the right one, the wrong one picked. */
function pickState(answered: boolean, picked: boolean, right: boolean): css.Pick {
  if (!answered) return picked ? 'picked' : 'plain';
  return right ? 'good' : picked ? 'bad' : 'plain';
}

// ---------------------------------------------------------------------------------------------
// Cards

interface RowProps {
  cards: readonly CardValue[];
  /** After the answer: the hand whose five have the gold edge (`core` raised too). */
  facts: HandFacts | null;
  /** The deal order of the first card (a second row continues the first). */
  start: number;
  /** A smaller card than the felt's full width allows (`css.handInButton`, `css.handSide`). */
  look?: CSSProperties | undefined;
}

const CardRow = memo(function CardRow({ cards, facts, start, look }: RowProps) {
  return (
    <span style={look ?? css.hand}>
      {cards.map((card, i) => {
        const core = facts?.core.includes(card) ?? false;
        const counted = facts?.best5.includes(card) ?? false;
        return (
          <span
            key={card}
            className={s.slot}
            style={{ animationDelay: `${(start + i) * DEAL_STAGGER_MS}ms` }}
          >
            <Card
              card={card}
              size="board"
              highlight={core ? 'core' : counted ? 'kicker' : undefined}
            />
          </span>
        );
      })}
    </span>
  );
});

/** ✓ or ✕ after the answer (SVG, never a text glyph); the words say it too. */
function Mark({ state }: { state: css.Pick }) {
  if (state === 'good') {
    return (
      <span className={cx(s.icon, s.zoom)} style={css.markGood}>
        <CheckIcon />
      </span>
    );
  }
  if (state === 'bad') {
    return (
      <span className={cx(s.icon, s.zoom)} style={css.markBad}>
        <SpriteIcon id={ICONS.close} />
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The question

interface StageProps {
  view: DrillView;
  right: string | null;
  onOption: (id: string) => void;
}

function OptionButton({
  id,
  view,
  right,
  onOption,
  big = false,
}: StageProps & { id: string; big?: boolean | undefined }) {
  const state = pickState(view.result !== null, view.picks.option === id, id === right);
  return (
    <button
      type="button"
      className={cx(levels.button, big && s.zoom)}
      style={css.choice(state, big ? 'big' : 'option')}
      aria-pressed={view.picks.option === id}
      onClick={() => onOption(id)}
      data-option={id}
    >
      {optionLabel(view.question, id)}
      <Mark state={state} />
    </button>
  );
}

function ResultLine({
  who,
  facts,
  own,
  outcome,
}: {
  who: string;
  facts: HandFacts;
  own: readonly CardValue[];
  outcome: Exclude<css.Outcome, null>;
}) {
  const A = W.answer;
  return (
    <div>
      <p style={css.resultHead}>
        <span style={css.who}>{who}</span>
        <b>{facts.name}</b>
        <span style={css.tag(outcome)}>
          {outcome === 'win' ? A.wins : outcome === 'lose' ? A.loses : A.split}
        </span>
      </p>
      <span style={css.minis}>
        {facts.best5.map((card) => (
          <Card
            key={card}
            card={card}
            size="sm"
            highlight={facts.core.includes(card) ? 'core' : 'kicker'}
            used={own.includes(card)}
          />
        ))}
      </span>
    </div>
  );
}

function Stage({ view, right, onOption }: StageProps) {
  const q = view.question;
  const answered = view.result !== null;
  const option = (id: string, big?: boolean) => (
    <OptionButton key={id} id={id} view={view} right={right} onOption={onOption} big={big} />
  );
  switch (q.type) {
    case 'cards':
      return <CardRow cards={q.cards} facts={answered ? q.hand : null} start={0} />;
    case 'holdem':
      return (
        <div style={css.seatRows}>
          <p style={css.seatSide}>{W.table}</p>
          <CardRow cards={q.board} facts={answered ? q.hand : null} start={0} look={css.handSide} />
          <p style={css.seatSide}>{W.yourHand}</p>
          <CardRow cards={q.hole} facts={answered ? q.hand : null} start={5} look={css.handSide} />
        </div>
      );
    case 'showdown': {
      const tie = q.answer === 'split';
      const you: Exclude<css.Outcome, null> = tie ? 'tie' : q.answer === 'you' ? 'win' : 'lose';
      const opp: Exclude<css.Outcome, null> = tie ? 'tie' : q.answer === 'opp' ? 'win' : 'lose';
      return (
        <>
          <p style={css.seat}>{W.table}</p>
          <CardRow cards={q.board} facts={null} start={0} />
          <div style={css.seats}>
            <div style={css.box(answered ? you : null)}>
              <p style={css.seat}>{W.you}</p>
              <CardRow cards={q.you} facts={null} start={5} />
            </div>
            <div style={css.box(answered ? opp : null)}>
              <p style={css.seat}>{W.opponent}</p>
              <CardRow cards={q.opp} facts={null} start={7} />
            </div>
          </div>
          <div style={css.options}>{['you', 'opp', 'split'].map((id) => option(id))}</div>
          {answered && (
            <div className={s.rise} style={css.result}>
              <ResultLine who={W.you} facts={q.hands[0]} own={q.you} outcome={you} />
              <ResultLine who={W.opponent} facts={q.hands[1]} own={q.opp} outcome={opp} />
              <p style={css.small}>{W.answer.legend}</p>
            </div>
          )}
        </>
      );
    }
    case 'versus':
      return (
        <>
          {(['a', 'b'] as const).map((id, i) => {
            const facts = q.hands[i] as HandFacts;
            const chosen = view.picks.option === id;
            const outcome: css.Outcome = !answered
              ? null
              : q.answer === 'tie'
                ? 'tie'
                : q.answer === id
                  ? 'win'
                  : chosen
                    ? 'lose'
                    : null;
            return (
              <button
                key={id}
                type="button"
                style={css.box(outcome, true)}
                aria-pressed={chosen}
                onClick={() => onOption(id)}
                data-option={id}
              >
                <span style={css.seat}>{i === 0 ? W.handA : W.handB}</span>
                <CardRow
                  cards={q.cards[i] as readonly CardValue[]}
                  facts={answered ? facts : null}
                  start={i * 5}
                  look={css.handInButton}
                />
                {answered && <b>{W.answer.handLine(facts.name, facts.pos)}</b>}
              </button>
            );
          })}
          <div style={css.options}>{option('tie')}</div>
        </>
      );
    case 'hl':
      return <div style={css.options}>{q.options.map((p) => option(String(p), true))}</div>;
    case 'above':
    case 'below':
      return (
        <>
          <p className={s.zoom} style={css.bigName}>
            {nameAt(q.target)}
          </p>
          <p style={css.direction}>
            <span
              className={s.icon}
              style={{
                ...css.icon18,
                transform: q.type === 'above' ? 'rotate(180deg)' : undefined,
              }}
            >
              <ChevronDownIcon />
            </span>
            {q.type === 'above' ? W.stronger : W.weaker}
          </p>
        </>
      );
    case 'pos2name':
      return (
        <span style={css.center}>
          <span
            className={s.zoom}
            style={css.chip('plain', 112)}
            role="img"
            aria-label={W.positionName(q.pos)}
          >
            {q.pos}
          </span>
        </span>
      );
    case 'name2pos':
      return (
        <p className={s.zoom} style={css.bigName}>
          {nameAt(q.pos)}
        </p>
      );
  }
}

/** A picker's heading. Once answered there is nothing to pick: only a screen reader hears it. */
function PickerLabel({
  id,
  answered,
  name,
  note,
}: {
  id: string;
  answered: boolean;
  name: string;
  note: string;
}) {
  return (
    <p
      id={id}
      style={answered ? undefined : css.label}
      className={answered ? screen.srOnly : undefined}
    >
      <span>{name}</span>
      <span style={css.labelNote}>{note}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Counters and the chip burst

interface CounterProps {
  label: string;
  value: string;
  /** The number that pops when it goes up. */
  n: number;
  pop: boolean;
  /** The streak counter: where the chip burst starts. */
  anchor?: Ref<HTMLDivElement> | undefined;
}

function Counter({ label, value, n, pop, anchor }: CounterProps) {
  // The number pops when it goes up (not on the first render, and not under reduced motion).
  const seen = useRef(n);
  const [bumps, setBumps] = useState(0);
  useEffect(() => {
    if (n > seen.current && pop) setBumps((b) => b + 1);
    seen.current = n;
  }, [n, pop]);
  return (
    <div style={css.count} ref={anchor}>
      <span>{label}</span>
      <b key={bumps} className={bumps > 0 ? s.pop : undefined} style={css.countValue}>
        {value}
      </b>
    </div>
  );
}

/** 12 chips thrown up from the streak counter, at fixed angles (decoration needs no randomness). */
const BURST = Array.from({ length: 12 }, (_, i) => {
  const angle = ((-170 + (160 * i) / 11) * Math.PI) / 180;
  const reach = [70, 120, 95][i % 3] as number;
  return {
    x: Math.round(Math.cos(angle) * reach),
    y: Math.round(Math.sin(angle) * reach),
    turn: i % 2 === 0 ? 150 : -150,
    colour: ['var(--avatar-0)', 'var(--accent)', 'var(--grade-best)', 'var(--suit-hearts)'][
      i % 4
    ] as string,
    delay: (i * 37) % 80,
  };
});

function Burst({ from }: { from: { readonly current: HTMLElement | null } }) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [done, setDone] = useState(false);
  useLayoutEffect(() => {
    const box = from.current?.getBoundingClientRect();
    if (box !== undefined) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    const timer = window.setTimeout(() => setDone(true), 1150);
    return () => window.clearTimeout(timer);
  }, [from]);
  if (done || origin === null) return null;
  return (
    <span aria-hidden="true">
      {BURST.map((b, i) => (
        <span
          key={i}
          className={s.burst}
          style={
            {
              left: origin.x,
              top: origin.y,
              animationDelay: `${b.delay}ms`,
              '--bx': `${b.x}px`,
              '--by': `${b.y}px`,
              '--br': `${b.turn}deg`,
              '--bc': b.colour,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The page

export interface DrillPageProps {
  /** The drill's logic (`app/drill.ts`), loaded with the page. */
  logic: DrillModule;
  /**
   * The Table's rankings drawer (§13.1), for All hands. The frame passes it in from the screens
   * chunk, which holds it already: a static import here cut `ui/format.ts` out of the entry chunk
   * into an initial file of its own (pitfall 47).
   */
  Drawer: ComponentType<RankingsDrawerProps>;
}

export function DrillPage({ logic, Drawer }: DrillPageProps) {
  const session = useMemo(() => logic.drillSession(), [logic]);
  const view = useSyncExternalStore(session.subscribe, session.view, session.view);
  useEffect(() => session.open(), [session]);

  const [gamesOpen, setGamesOpen] = useOverlay('drillGames');
  const [statsOpen, setStatsOpen] = useOverlay('drillStats');
  const [handsOpen, setHandsOpen] = useOverlay('rankings');
  const [leaving, setLeaving] = useState(false);
  const [still] = useState(motionReduced);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLElement>(null);
  const streakRef = useRef<HTMLDivElement>(null);
  /** Next was pressed from the keyboard (or a screen reader): the new prompt takes the focus. */
  const focusPrompt = useRef(false);
  const ids = useId();

  const q = view.question;
  const answered = view.result !== null;
  const ok = view.result === true;
  const options = useMemo(() => logic.optionsOf(q), [logic, q]);
  const showNames = logic.needsName(q);
  const showPositions = logic.needsPosition(q);
  const rightName = logic.rightName(q);
  const rightPosition = logic.rightPosition(q);

  /** Brings the question back into view when the page has scrolled past it (as the old drill). */
  const scrollToPlay = useCallback((whenBelow: boolean) => {
    const play = playRef.current;
    if (play === null) return;
    const box = play.getBoundingClientRect();
    if (box.top < 0 || (whenBelow && box.bottom > window.innerHeight)) {
      play.scrollIntoView?.({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
    }
  }, []);

  const next = useCallback(() => {
    if (leaving) return;
    const focused = document.activeElement;
    focusPrompt.current = focused === nextRef.current || focused === document.body;
    if (motionReduced()) session.next();
    else setLeaving(true);
  }, [leaving, session]);

  // The exit animation, then the next question.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setLeaving(false);
      session.next();
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, session]);

  // After an answer: Next takes the focus, and the feedback comes into view.
  useEffect(() => {
    if (!answered) return;
    nextRef.current?.focus({ preventScroll: true });
    scrollToPlay(true);
  }, [answered, scrollToPlay]);

  // A new question: back into view; its prompt takes the focus if Next had it.
  const dealt = useRef(view.seq);
  useEffect(() => {
    if (dealt.current === view.seq) return;
    dealt.current = view.seq;
    scrollToPlay(false);
    if (!focusPrompt.current) return;
    focusPrompt.current = false;
    promptRef.current?.focus({ preventScroll: true });
  }, [view.seq, scrollToPlay]);

  // The keyboard (see the module note). The sheets take their own keys (Esc) while open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (gamesOpen || statsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      const hands = key === 'h' || key === 'H';
      if (handsOpen) {
        if (hands) {
          e.preventDefault();
          setHandsOpen(false);
        }
        return;
      }
      if (hands) {
        e.preventDefault();
        setHandsOpen(true);
        return;
      }
      if (answered) {
        // A focused button takes its own Enter and Space.
        const onControl =
          e.target instanceof Element && e.target.closest('button, a, input, select') !== null;
        if ((key === 'Enter' || key === ' ') && !onControl) {
          e.preventDefault();
          next();
        }
        return;
      }
      if (options.length > 0) {
        const k = key.toLowerCase();
        let id: string | undefined;
        if (/^[1-9]$/.test(k)) id = options[Number(k) - 1];
        else if (q.type === 'versus' && (k === 'a' || k === 'b')) id = k;
        else if (q.type === 'versus' && k === 't') id = 'tie';
        if (id !== undefined) session.pickOption(id);
        return;
      }
      if (showPositions && /^[0-9]$/.test(key)) {
        session.pickPosition((key === '0' ? 10 : Number(key)) as Position);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    gamesOpen,
    statsOpen,
    handsOpen,
    setHandsOpen,
    answered,
    next,
    options,
    q.type,
    session,
    showPositions,
  ]);

  const lines = answered
    ? answerLines(q, view.picks, ok)
    : { first: hintOf(q), second: '', trap: false };

  const marked = useMemo(
    () =>
      answered
        ? { categories: logic.involved(q).map((p) => logic.categoryAt(p)), label: W.thisRound }
        : undefined,
    [answered, logic, q],
  );

  const game = W.games[view.data.game];
  const difficulty = W.difficulties[view.data.difficulty];
  const openHands = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.focus(); // Safari does not focus a tapped button; the drawer returns focus here
    setHandsOpen(true);
  };

  return (
    <div className={s.drill} style={css.page}>
      <div style={css.tally}>
        <Counter
          label={W.streak}
          value={String(view.streak)}
          n={view.streak}
          pop={!still}
          anchor={streakRef}
        />
        <Counter
          label={W.score}
          value={W.scoreValue(view.right, view.total)}
          n={view.right}
          pop={!still}
        />
        <Counter label={W.best} value={String(view.data.best)} n={view.data.best} pop={!still} />
      </div>

      <div style={css.controls}>
        <button
          type="button"
          className={levels.button}
          style={css.gameButton}
          aria-label={`${W.choose}: ${game.name}, ${difficulty.name}`}
          onClick={() => setGamesOpen(true)}
          data-drill-games=""
        >
          <span style={css.gameText}>
            <span style={css.gameName} data-drill-game-name="">
              {'short' in game ? game.short : game.name}
            </span>
            <span style={css.accentCaps}>{difficulty.name}</span>
          </span>
          <span className={s.icon} style={css.icon18}>
            <ChevronDownIcon />
          </span>
        </button>
        <button
          type="button"
          className={levels.button}
          aria-expanded={handsOpen}
          onClick={openHands}
          data-drill-hands=""
        >
          {W.allHands}
        </button>
        <button
          type="button"
          className={levels.button}
          onClick={() => setStatsOpen(true)}
          data-drill-stats=""
        >
          {W.stats}
        </button>
      </div>

      <section ref={playRef} style={css.play} aria-labelledby={`${ids}-prompt`}>
        <p
          key={`p${view.seq}`}
          ref={promptRef}
          id={`${ids}-prompt`}
          className={s.prompt}
          tabIndex={-1}
          data-question={q.type}
        >
          {promptOf(q)}
        </p>
        <div
          key={view.seq}
          className={cx(screen.felt, leaving && s.out)}
          style={css.stage}
          data-answered={answered ? '' : undefined}
        >
          <Stage
            view={view}
            right={logic.rightOption(q)}
            onOption={(id) => session.pickOption(id)}
          />
        </div>
        <div
          className={answered ? (ok ? s.ok : s.no) : undefined}
          style={css.feedback(view.result)}
        >
          <div
            style={css.lines}
            role="status"
            data-feedback={answered ? (ok ? 'right' : 'wrong') : ''}
          >
            <p style={css.first}>
              {lines.first}
              {lines.trap && <span style={css.trapTag}>{W.trap}</span>}
            </p>
            {lines.second !== '' && <p style={css.second}>{lines.second}</p>}
          </div>
          {answered && (
            <button
              ref={nextRef}
              type="button"
              className={cx(screen.primary, s.zoom)}
              style={css.next}
              onClick={next}
            >
              {W.next}
            </button>
          )}
        </div>
      </section>

      {showNames && (
        <section aria-labelledby={`${ids}-names`}>
          <PickerLabel id={`${ids}-names`} answered={answered} name={W.hand} note={W.pickOne} />
          <div style={css.names}>
            {BY_NAME.map((p) => {
              const picked = view.picks.name === p;
              const state = pickState(answered, picked, p === rightName);
              return (
                <button
                  key={p}
                  type="button"
                  className={levels.button}
                  style={css.choice(state)}
                  aria-pressed={picked}
                  onClick={() => session.pickName(p)}
                  data-name={RANKINGS[p - 1]?.key}
                >
                  {nameAt(p)}
                  <Mark state={state} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {showPositions && (
        <section aria-labelledby={`${ids}-positions`}>
          <PickerLabel
            id={`${ids}-positions`}
            answered={answered}
            name={W.position}
            note={W.ladder}
          />
          <div style={css.chips}>
            {logic.POSITIONS.map((p) => {
              const picked = view.picks.position === p;
              return (
                <button
                  key={p}
                  type="button"
                  style={css.chip(pickState(answered, picked, p === rightPosition))}
                  aria-label={W.positionName(p)}
                  aria-pressed={picked}
                  onClick={() => session.pickPosition(p)}
                  data-position={p}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <p className={s.keys}>{W.keyboard}</p>

      {gamesOpen && (
        <GamesSheet
          data={view.data}
          games={logic.GAME_IDS}
          difficulties={logic.DIFFICULTIES}
          onDifficulty={(d) => session.setDifficulty(d)}
          onGame={(g) => {
            setGamesOpen(false);
            session.setGame(g);
          }}
          onClose={() => setGamesOpen(false)}
        />
      )}
      {statsOpen && (
        <StatsSheet
          data={view.data}
          onReset={() => session.resetStats()}
          onClose={() => setStatsOpen(false)}
        />
      )}
      <div className={s.drawer}>
        <Drawer
          open={handsOpen}
          onOpenChange={(open) => setHandsOpen(open)}
          hero={null}
          marked={marked}
        />
      </div>
      {view.bursts > 0 && !still && <Burst key={view.bursts} from={streakRef} />}
    </div>
  );
}
