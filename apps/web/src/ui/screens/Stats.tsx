/**
 * The Stats screen (PLAN §14.4, chunk 8.2): four pages, Progress (the first time), Results, Hands
 * (the collection) and History (→ Review). A lazy chunk (`React.lazy` in ui/App.tsx, §15.3) with
 * its words (`i18n/stats.ts`) and numbers (`ui/stats.ts`); the controller reads the stored hands
 * for History (`history` command) and opens one in Review (`historyReview`).
 *
 * - Empty states teach: below 5 hands Progress and Results say "Play 5 hands to see your first
 *   stats." The Hands and History pages always show.
 * - Charts are tiny inline SVGs, each with a `<desc>` and a visually hidden data table.
 * - The History list (up to 100 rows) uses `content-visibility: auto`.
 * - No stylesheet of its own: the classes of `Screen.module.css` and a few inline styles (no
 *   `:hover` or media rules), which travel in this lazy chunk. All CSS is one stylesheet that first
 *   paint loads (§15.3), so rules for Stats there would cost every launch.
 * - The page the player looked at last comes back when the screen does (Review → Back).
 * - Chunk 8.4: the level suggestion card (§10.4) at the top of Progress, and History's footer
 *   [Export] [Import] (§14.4, the same commands as Settings → Data; the Data chunk loads when Stats
 *   opens, `DATA_SCREENS`, so Export's share sheet opens inside the tap).
 * - The leaks lead Progress (1.3.101: what to work on comes before the numbers); with none yet the
 *   numbers do. Each leak links to the lesson about it (§8.9, `LEAK_LESSON`): "Lesson 6: Pot odds"
 *   opens it in Learn over Stats (the `lesson` command, by number: Learn's lessons stay in its own
 *   chunk), and Back comes back to Progress.
 */
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  selectHistory,
  selectStats,
  useAppStore,
  useDispatch,
  type HistoryItem,
  type Stats as StatsData,
} from '../../app/store.ts';
import type { Grade } from '../../brain/types.ts';
import { RANKINGS } from '../../data/rankings.ts';
import type { BotLevel } from '../../engine/types.ts';
import type { HandCategory } from '../../eval/evaluate.ts';
import { en } from '../../i18n/en.ts';
import { statsWords as W } from '../../i18n/stats.ts';
import { Card } from '../components/Card.tsx';
import { FileButton } from '../components/FileButton.tsx';
import { LevelSuggestion } from '../components/SuggestionCard.tsx';
import { formatChips } from '../format.ts';
import { exampleCards } from '../rankings.ts';
import {
  LEAK_LESSON,
  statsView,
  type LeakLesson,
  type ProgressView,
  type ResultsView,
  type StatsView,
} from '../stats.ts';
import { ScreenBar } from './ScreenBar.tsx';
import screen from './Screen.module.css';
import { STATS_MARKER } from './statsMarker.ts';

export type StatsTab = 'progress' | 'results' | 'hands' | 'history';
const TABS: readonly StatsTab[] = ['progress', 'results', 'hands', 'history'];

// ---------------------------------------------------------------------------------------------
// Inline styles (see the module note)

const S = {
  tabs: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  face: { padding: '0 4px', fontSize: '0.9375rem' },
  page: { display: 'grid', gap: 'var(--space-4)', paddingBottom: 'var(--space-5)' },
  card: {
    display: 'grid',
    gap: 'var(--space-2)',
    margin: 0,
    padding: 'var(--space-3) var(--space-4)',
    borderRadius: 'var(--radius-3)',
    background: 'var(--surface)',
  },
  title: { margin: 0, fontSize: '1.0625rem', fontWeight: 700 },
  text: { margin: 0 },
  list: { display: 'grid', margin: 0, padding: 0 },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 'var(--space-3)',
    padding: '6px 0',
  },
  value: { margin: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
  big: { fontSize: '1.75rem', lineHeight: 1.1 },
  chart: { display: 'block', width: '100%', height: 'auto', color: 'var(--accent)' },
  figure: { margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' },
  cell: { padding: '6px 0', textAlign: 'right' },
  head: { padding: '6px 0', color: 'var(--muted)', fontWeight: 600, textAlign: 'right' },
  rows: { display: 'grid', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' },
  hand: {
    display: 'grid',
    gap: '6px',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-3)',
    background: 'var(--surface)',
  },
  cards: { display: 'flex', gap: '2px' },
  muted: { color: 'var(--muted)', fontSize: '0.875rem' },
  lazyRow: { contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' },
  rowButton: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 'var(--space-3)',
    width: '100%',
    minWidth: 'var(--tap-min)',
    minHeight: '56px',
    padding: 'var(--space-2) var(--space-3)',
    border: 0,
    borderRadius: 'var(--radius-3)',
    background: 'var(--surface)',
    color: 'var(--text)',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  stack: { display: 'grid', gap: '2px', minWidth: 0 },
  side: { display: 'grid', gap: '4px', justifyItems: 'end' },
  strong: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  summary: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 'var(--tap-min)',
    minHeight: 'var(--tap-min)',
    cursor: 'pointer',
  },
  lock: { width: 14, height: 14, flex: 'none' },
  /** A leak's lesson link (§8.9): its own line, its words flush with the leak's. */
  lessonLink: { display: 'block', padding: 0, textAlign: 'left' },
  line: { display: 'flex', alignItems: 'center', gap: '6px' },
} satisfies Record<string, CSSProperties>;

const GRADE_COLOUR: Readonly<Record<Grade, string>> = {
  best: 'var(--grade-best)',
  good: 'var(--grade-good)',
  inaccuracy: 'var(--grade-slightly-off)',
  mistake: 'var(--grade-mistake)',
  blunder: 'var(--grade-big-mistake)',
};

const LEVEL_NAME: Readonly<Record<BotLevel, string>> = en.levels.bot;

// ---------------------------------------------------------------------------------------------
// Formats

/** "+640", "−40" (a real minus sign) or "0". */
function signed(n: number): string {
  if (n > 0) return `+${formatChips(n)}`;
  return n < 0 ? `−${formatChips(-n)}` : '0';
}

/** "+7.5", "−12" (one decimal at most) or "0". */
function signedDecimal(n: number): string {
  const text = Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 1 });
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : '0';
}

const pct = (n: number | null): string => (n === null ? W.none : `${n}%`);
const num = (n: number | null): string => (n === null ? W.none : formatChips(n));

// Times are stored in UTC and shown in the device's time zone (§14.4), in English words.
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateText = (iso: string): string => DATE.format(new Date(iso));
const timeText = (iso: string): string => TIME.format(new Date(iso));

const NAME: Readonly<Record<HandCategory, string>> = Object.fromEntries(
  RANKINGS.map((row) => [row.key, row.name]),
) as Record<HandCategory, string>;

// ---------------------------------------------------------------------------------------------
// Pieces

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section style={S.card} aria-labelledby={id}>
      <h2 id={id} style={S.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Label and value rows (`data-stat` names each for tests). */
function Rows({ rows }: { rows: readonly [key: string, label: string, value: ReactNode][] }) {
  return (
    <dl style={S.list}>
      {rows.map(([key, label, value]) => (
        <div key={key} style={S.row} data-stat={key}>
          <dt>{label}</dt>
          <dd style={S.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A chart's numbers for screen readers (§14.4: a visually hidden data table). The hiding is on a
 * wrapper, never on the table: a table is as wide as its cells whatever its `width` says, so the
 * 1 px box stayed a 300 px table, and with `nowrap` it reached past the card and made the whole
 * page pan sideways on a 360–390 px phone (`overflow: hidden` on a block clips it, and clipped
 * overflow does not widen the page).
 */
function DataTable({ caption, values }: { caption: string; values: readonly (number | null)[] }) {
  return (
    <div className={screen.srOnly}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{W.progress.sessionCol}</th>
            <th scope="col">{W.progress.value}</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, i) => (
            <tr key={i}>
              <th scope="row">{W.progress.sessionRow(i + 1)}</th>
              <td>{v === null ? W.none : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHART_W = 300;
const CHART_H = 90;
const PAD = 6;

/** The decision score of the last sessions (0–100), a line; sessions without a score are gaps. */
function ScoreChart({ values }: { values: readonly (number | null)[] }) {
  const n = values.length;
  const x = (i: number): number =>
    n === 1 ? CHART_W / 2 : PAD + (i * (CHART_W - 2 * PAD)) / (n - 1);
  const y = (v: number): number => PAD + ((100 - v) * (CHART_H - 2 * PAD)) / 100;
  const points = values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as const]));
  const latest = [...values].reverse().find((v) => v !== null) ?? null;
  return (
    <figure style={S.figure}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        style={S.chart}
        role="img"
        aria-label={W.progress.scoreChart}
        data-chart="score"
      >
        <desc>{`${W.progress.scoreChart} ${latest === null ? '' : String(latest)}`}</desc>
        <line x1={0} x2={CHART_W} y1={y(50)} y2={y(50)} stroke="var(--muted)" strokeOpacity={0.4} />
        <polyline
          points={points.map(([px, py]) => `${px},${py}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
        {points.map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r={3.5} fill="currentColor" />
        ))}
      </svg>
      <DataTable caption={W.progress.scoreChart} values={values} />
    </figure>
  );
}

/** Mistakes per 100 decisions in the last sessions, as bars (lower is better). */
function MistakesChart({ values }: { values: readonly number[] }) {
  const n = values.length;
  const max = Math.max(10, ...values);
  const step = (CHART_W - 2 * PAD) / Math.max(n, 1);
  const barW = Math.max(4, step * 0.6);
  return (
    <figure style={S.figure}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        style={S.chart}
        role="img"
        aria-label={W.progress.mistakesChart}
        data-chart="mistakes"
      >
        <desc>{W.progress.mistakesChart}</desc>
        <line x1={0} x2={CHART_W} y1={CHART_H - PAD} y2={CHART_H - PAD} stroke="var(--muted)" />
        {values.map((v, i) => {
          const h = (v * (CHART_H - 2 * PAD)) / max;
          return (
            <rect
              key={i}
              x={PAD + i * step + (step - barW) / 2}
              y={CHART_H - PAD - h}
              width={barW}
              height={h}
              fill="currentColor"
            />
          );
        })}
      </svg>
      <DataTable caption={W.progress.mistakesChart} values={values} />
    </figure>
  );
}

/** "79 ↑ 4": the arrow is drawn, the change said in words (colour is not the cue). */
function Change({ change }: { change: number | null }) {
  if (change === null || change === 0) return null;
  const n = String(Math.abs(change));
  return (
    <>
      {' '}
      <span aria-hidden="true">{change > 0 ? W.up(n) : W.down(n)}</span>
      <span className={screen.srOnly}>{change > 0 ? W.upSpoken(n) : W.downSpoken(n)}</span>
    </>
  );
}

function Empty({ hands }: { hands: number }) {
  return (
    <div style={S.card} data-stats-empty="">
      <p style={{ ...S.text, ...S.strong }}>{W.empty}</p>
      <p className={screen.hint}>{W.soFar(formatChips(hands))}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pages

/** The top 3 leaks with what they cost and the lesson about each (§8.9, §14.4). */
function Leaks({ p, onLesson }: { p: ProgressView; onLesson: (n: LeakLesson) => void }) {
  return (
    <Section title={W.progress.leaks}>
      {p.leaks.length === 0 ? (
        <p style={S.text}>{W.progress.leaksNone}</p>
      ) : (
        <ol style={S.rows}>
          {p.leaks.map((leak) => {
            const lesson = LEAK_LESSON[leak.id];
            return (
              <li key={leak.id} data-leak={leak.id}>
                <span style={S.strong}>{W.leaks[leak.id]}</span>
                <br />
                <span style={S.muted}>
                  {W.progress.leakLine(formatChips(leak.count), formatChips(leak.chips))}
                </span>
                <button
                  type="button"
                  className={screen.link}
                  style={S.lessonLink}
                  onClick={() => onLesson(lesson)}
                  data-leak-lesson={lesson}
                >
                  {W.progress.lessonLink(lesson, W.lessons[lesson])}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Progress({ p, onLesson }: { p: ProgressView; onLesson: (n: LeakLesson) => void }) {
  const sessionLabel = p.score.last ? W.progress.lastSession : W.progress.session;
  const hasLeaks = p.leaks.length > 0;
  return (
    <div style={S.page}>
      <LevelSuggestion />
      {/* What to work on first (1.3.101); with no leak yet the numbers come first. */}
      {hasLeaks && <Leaks p={p} onLesson={onLesson} />}
      <Section title={W.progress.score}>
        <p className={screen.hint}>{W.progress.scoreHint}</p>
        <Rows
          rows={[
            [
              'scoreSession',
              sessionLabel,
              <span style={S.big} key="v">
                {num(p.score.session)}
              </span>,
            ],
            [
              'scoreWeek',
              W.progress.week,
              <span key="v">
                {num(p.score.week)}
                <Change change={p.score.change} />
              </span>,
            ],
          ]}
        />
        {p.score.series.some((v) => v !== null) && <ScoreChart values={p.score.series} />}
      </Section>

      <Section title={W.progress.mistakes}>
        <Rows
          rows={[
            ['mistakesSession', sessionLabel, num(p.mistakes.session)],
            ['mistakesWeek', W.progress.week, num(p.mistakes.week)],
          ]}
        />
        {p.mistakes.series.length > 0 && <MistakesChart values={p.mistakes.series} />}
        <p className={screen.hint}>{W.progress.lower}</p>
      </Section>

      <Section title={W.progress.own}>
        <p style={S.text} data-stat="own">
          {p.own === null ? W.progress.ownNone : W.progress.ownText(pct(p.own))}
        </p>
      </Section>

      <Section title={W.progress.follow}>
        <p style={S.text} data-stat="follow">
          {p.follow === null ? W.progress.followNone : W.progress.followText(pct(p.follow))}
        </p>
      </Section>

      <Section title={W.progress.streak}>
        <p style={S.text} data-stat="streak">
          {W.progress.streakText(formatChips(p.streak.current))}
        </p>
        <p className={screen.hint} data-stat="streakBest">
          {W.progress.streakBest(formatChips(p.streak.best))}
        </p>
      </Section>

      {!hasLeaks && <Leaks p={p} onLesson={onLesson} />}

      <div style={S.card}>
        <p style={S.text} data-stat="undo">
          {W.progress.undo(formatChips(p.fixedWithUndo))}
        </p>
        {p.quiz.asked > 0 && (
          <p style={S.text} data-stat="quiz">
            {W.progress.quiz(formatChips(p.quiz.right), formatChips(p.quiz.asked), pct(p.quiz.pct))}
          </p>
        )}
      </div>
    </div>
  );
}

function Results({ r }: { r: ResultsView }) {
  const luck = r.luck;
  return (
    <div style={S.page}>
      <div style={S.card}>
        <Rows
          rows={[
            ['hands', W.results.hands, formatChips(r.hands)],
            ['won', W.results.won, formatChips(r.won)],
            ['net', W.results.net, signed(r.netChips)],
            ['bb100', W.results.bb100, r.bb100 === null ? W.none : signedDecimal(r.bb100)],
          ]}
        />
        <p style={S.text} data-stat="style">
          {W.results.style(pct(r.vpip), pct(r.pfr))}
        </p>
        <p className={screen.hint}>{W.results.good}</p>
        <Rows
          rows={[
            [
              'showdown',
              W.results.showdown,
              W.results.showdownText(
                formatChips(r.showdownWins),
                formatChips(r.showdowns),
                pct(r.showdownPct),
              ),
            ],
            ['biggest', W.results.biggest, formatChips(r.biggestPot)],
            ['reloads', W.results.reloads, formatChips(r.reloads)],
          ]}
        />
      </div>

      <Section title={W.results.luck}>
        {luck === null ? (
          <p style={S.text}>{W.results.luckNone}</p>
        ) : (
          <>
            <p style={S.text} data-stat="luck">
              {W.results.luckLine(signed(luck.expected), signed(luck.actual))}
            </p>
            <p style={S.text}>
              {luck.luck > 0
                ? W.results.lucky(formatChips(luck.luck))
                : luck.luck < 0
                  ? W.results.unlucky(formatChips(-luck.luck))
                  : W.results.even}
            </p>
          </>
        )}
      </Section>

      {r.byLevel.length > 0 && (
        <Section title={W.results.byLevel}>
          <table style={S.table}>
            <thead>
              <tr>
                <th scope="col" style={{ ...S.head, textAlign: 'left' }}>
                  {W.results.level}
                </th>
                <th scope="col" style={S.head}>
                  {W.results.levelHands}
                </th>
                <th scope="col" style={S.head}>
                  {W.results.levelBb}
                </th>
              </tr>
            </thead>
            <tbody>
              {r.byLevel.map((row) => (
                <tr key={row.level} data-level={row.level}>
                  <th scope="row" style={{ ...S.cell, textAlign: 'left', fontWeight: 400 }}>
                    {LEVEL_NAME[row.level]}
                  </th>
                  <td style={S.cell}>{formatChips(row.hands)}</td>
                  <td style={S.cell}>{row.bb100 === null ? W.none : signedDecimal(row.bb100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <p className={screen.hint} data-stat="practice">
        {W.results.practice(formatChips(r.practice))}
      </p>
    </div>
  );
}

/** A padlock (never-made rows, §14.4): drawn, and the words say it too. */
function Lock() {
  return (
    <svg viewBox="0 0 16 16" style={S.lock} aria-hidden="true" focusable="false">
      <path
        d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3 7h10v7H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function Collection({ view }: { view: StatsView }) {
  return (
    <div style={S.page}>
      <p className={screen.hint}>{W.collection.note}</p>
      <ol style={S.rows} data-examples="">
        {view.collection.map((row, i) => {
          const data = RANKINGS[i] as (typeof RANKINGS)[number];
          return (
            <li key={row.category} style={S.hand} data-category={row.category}>
              <span style={S.strong}>{data.name}</span>
              <span style={S.cards} aria-hidden="true">
                {exampleCards(data).map(({ card, highlight }) => (
                  <Card key={card} card={card} size="sm" highlight={highlight} />
                ))}
              </span>
              {row.count > 0 && row.first !== null ? (
                <span style={S.muted} data-made={row.count}>
                  {row.count === 1
                    ? W.collection.madeOnce(dateText(row.first))
                    : W.collection.made(formatChips(row.count), dateText(row.first))}
                </span>
              ) : (
                <span style={{ ...S.muted, ...S.line }} data-made={0}>
                  <Lock />
                  {`${W.collection.never} · ${W.collection.oneIn(formatChips(data.oneIn))}`}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A row's grades as dots: round for Best, Good and Slightly off, square for the mistakes. */
function GradeDots({ grades }: { grades: readonly (Grade | null)[] }) {
  const words = grades.map((g) => (g === null ? W.history.noGrade : W.grades[g]));
  return (
    <>
      <svg width={grades.length * 12} height={10} aria-hidden="true" focusable="false">
        {grades.map((g, i) =>
          g === 'mistake' || g === 'blunder' ? (
            <rect key={i} x={i * 12 + 1} y={1} width={8} height={8} fill={GRADE_COLOUR[g]} />
          ) : (
            <circle
              key={i}
              cx={i * 12 + 5}
              cy={5}
              r={4}
              fill={g === null ? 'none' : GRADE_COLOUR[g]}
              stroke={g === null ? 'var(--muted)' : 'none'}
            />
          ),
        )}
      </svg>
      <span className={screen.srOnly}>
        {grades.length === 0 ? W.history.noGrades : W.history.grades(words.join(', '))}
      </span>
    </>
  );
}

const HistoryList = memo(function HistoryList({
  items,
  onOpen,
}: {
  items: readonly HistoryItem[];
  onOpen: (handSeq: number) => void;
}) {
  return (
    <ol style={S.rows}>
      {items.map((item) => (
        <li key={item.handSeq} style={S.lazyRow}>
          <button
            type="button"
            style={S.rowButton}
            onClick={() => onOpen(item.handSeq)}
            data-history-hand={item.handSeq}
          >
            <span style={S.stack}>
              <span style={S.strong}>{W.history.hand(formatChips(item.handNumber))}</span>
              <span style={S.muted}>
                {[
                  timeText(item.at),
                  item.bestCategory === null ? null : NAME[item.bestCategory],
                  item.practice ? W.history.practice : null,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </span>
            </span>
            <span style={S.side}>
              <span style={S.strong}>{signed(item.net)}</span>
              <GradeDots grades={item.grades} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
});

function History({
  items,
  onOpen,
  onExport,
  onImport,
}: {
  items: readonly HistoryItem[] | null;
  onOpen: (handSeq: number) => void;
  onExport: (() => void) | undefined;
  onImport: ((file: File) => void) | undefined;
}) {
  return (
    <div style={S.page}>
      <h2 className={screen.sectionTitle}>{W.history.title}</h2>
      {items === null ? (
        <p className={screen.hint}>{W.history.loading}</p>
      ) : items.length === 0 ? (
        <p style={S.text}>{W.history.empty}</p>
      ) : (
        <HistoryList items={items} onOpen={onOpen} />
      )}
      <footer style={S.card}>
        <p style={S.text}>{W.history.saved}</p>
        {onExport && onImport && (
          <div className={screen.cardButtons}>
            <button type="button" className={screen.secondary} onClick={() => onExport()}>
              {W.history.export}
            </button>
            <FileButton
              label={W.history.import}
              className={`${screen.secondary} ${screen.fileButton}`}
              onFile={onImport}
            />
          </div>
        )}
        <details>
          <summary style={S.summary}>{W.history.where}</summary>
          <p style={S.text}>{W.history.whereText}</p>
        </details>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The screen

export interface StatsProps {
  /** The profile's stats; null before boot read them (or without storage): as no hand yet. */
  stats: StatsData | null;
  /** The big blind of the current settings: the leaks' chips. */
  bb: number;
  /** For the week (§14.4: local days). */
  now: Date;
  history: readonly HistoryItem[] | null;
  tab: StatsTab;
  onTab: (tab: StatsTab) => void;
  onOpenHand: (handSeq: number) => void;
  /** A leak's lesson link (§8.9): Learn opens that lesson over Stats; Back returns here. */
  onLesson: (lesson: number) => void;
  onBack: () => void;
  /** History's footer (chunk 8.4): Export, from the tap itself; the file picked for Import. */
  onExport?: (() => void) | undefined;
  onImport?: ((file: File) => void) | undefined;
}

export function Stats({
  stats,
  bb,
  now,
  history,
  tab,
  onTab,
  onOpenHand,
  onLesson,
  onBack,
  onExport,
  onImport,
}: StatsProps) {
  const name = useId();
  const view = useMemo(() => (stats === null ? null : statsView(stats, bb, now)), [stats, bb, now]);
  const hands = view?.hands ?? 0;
  let page: ReactNode;
  if (tab === 'history') {
    page = <History items={history} onOpen={onOpenHand} onExport={onExport} onImport={onImport} />;
  } else if (view === null || (tab !== 'hands' && !view.ready)) page = <Empty hands={hands} />;
  else if (tab === 'progress') page = <Progress p={view.progress} onLesson={onLesson} />;
  else if (tab === 'results') page = <Results r={view.results} />;
  else page = <Collection view={view} />;

  return (
    <main className={screen.page} data-stats={STATS_MARKER}>
      <ScreenBar title={en.stats.title} onBack={onBack} />
      <div className={screen.content}>
        <fieldset className={screen.section}>
          <legend className={screen.srOnly}>{W.tabs.label}</legend>
          <div className={screen.choices} style={S.tabs}>
            {TABS.map((t) => (
              <label key={t} className={screen.choice}>
                <input
                  type="radio"
                  name={name}
                  value={t}
                  checked={tab === t}
                  onChange={() => onTab(t)}
                  data-stats-tab={t}
                />
                <span className={screen.face} style={S.face}>
                  {W.tabs[t]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {page}
      </div>
    </main>
  );
}

/** The page the player looked at last (for the page's life): Back from Review comes back to it. */
let lastTab: StatsTab = 'progress';

/** The screen wired to the store. */
export function StatsRoute() {
  const dispatch = useDispatch();
  const stats = useAppStore(selectStats);
  const history = useAppStore(selectHistory);
  const bb = useAppStore((s) => s.settings.bb);
  const [tab, setTab] = useState<StatsTab>(lastTab);
  const [now] = useState(() => new Date());
  // History reads the stored hands when it is shown (again after a new hand made them stale).
  useEffect(() => {
    if (tab === 'history' && history === null) dispatch({ type: 'history' });
  }, [tab, history, dispatch]);
  return (
    <Stats
      stats={stats}
      bb={bb}
      now={now}
      history={history}
      tab={tab}
      onTab={(t) => {
        lastTab = t;
        setTab(t);
      }}
      onOpenHand={(handSeq) => dispatch({ type: 'historyReview', handSeq })}
      onLesson={(lesson) => dispatch({ type: 'lesson', lesson })}
      onBack={() => dispatch({ type: 'back' })}
      onExport={() => dispatch({ type: 'exportStats' })}
      onImport={(file) => dispatch({ type: 'importFile', file })}
    />
  );
}
