/**
 * Learn (PLAN §12.1, Appendix F.7–F.9; chunk 9.2): four screens in one lazy chunk (`React.lazy` in
 * ui/App.tsx; a dynamic `import()` keeps it out of the initial bundle, §15.3, and the service
 * worker precaches it, so it works offline).
 *
 * - **Learn** ('learn'): the seven lessons in order, then "Poker hands" and "Glossary" (and the hand
 *   drill once chunk 9.2b gives `onOpenDrill`). Home's tile and the Menu open it.
 * - **A lesson** ('lesson', the store's `ui.lesson`): "Lesson 3 of 7", its card picture and text
 *   (`LessonView`), lesson 4's "See all poker hands", then "Next: …" (the last one: "All lessons").
 *   Next changes the lesson in place, so Back always returns to the page under the lesson.
 *   Welcome's "New to poker? 1-minute guide" opens lesson 1.
 * - **Poker hands** ('handRankings'): the rankings panel's own component (`RankingsList`: the ten
 *   rows with their details on a tap, and the tie-break footer), full page, with no hand in play,
 *   and with "Which hand wins?" always (§13.2).
 * - **Glossary** ('glossary'): the searchable F.9 glossary (`GlossaryList`).
 *
 * Every page has the bar with Back (Android Back does the same, app/navigation.ts). A new page, or a
 * new lesson, starts at the top with the focus on its heading (§12.12): ScreenSwitcher does it for
 * a new screen, and the page does it again once it is drawn (after the chunk loaded) and for Next.
 */
import { useCallback, useEffect, useId, useRef, type RefObject } from 'react';
import { selectLesson, useAppStore, useDispatch } from '../../app/store.ts';
import { LESSONS } from '../../data/lessons.ts';
import { enCoach } from '../../i18n/enCoach.ts';
import { learnWords as W } from '../../i18n/learn.ts';
import { GlossaryList } from '../components/GlossaryList.tsx';
import { LessonView } from '../components/Lesson.tsx';
import { RankingsList } from '../components/RankingsList.tsx';
import type { LearnPage } from '../learn.ts';
import { ChevronLeftIcon } from './icons.tsx';
import styles from './Learn.module.css';
import { LEARN_MARKER } from './learnMarker.ts';
import { ScreenBar } from './ScreenBar.tsx';
import screen from './Screen.module.css';

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

/** On `key` (and on mount): the page at the top, the focus on its heading (§12.12). */
function useHeadingFocus(main: RefObject<HTMLElement | null>, key: unknown): void {
  useEffect(() => {
    const heading = main.current?.querySelector('h1');
    if (!heading) return;
    // `??`: jsdom and very old engines have no scrollingElement.
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [main, key]);
}

interface EntryProps {
  title: string;
  hint?: string | undefined;
  onClick: () => void;
}

/** One way on in the list: a full-width button with the way-on chevron. */
function Entry({ title, hint, onClick }: EntryProps) {
  return (
    <li>
      <button type="button" className={cx(styles.entry, styles.plain)} onClick={() => onClick()}>
        {/* The space keeps the title and the hint two words apart for screen readers; the grid
            drops it from the layout. */}
        <span className={styles.entryText}>
          <span className={styles.entryTitle}>{title}</span>
          {hint !== undefined && (
            <>
              {' '}
              <span className={styles.entryHint}>{hint}</span>
            </>
          )}
        </span>
        <ChevronLeftIcon />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// The pages

export interface LearnIndexProps {
  onBack: () => void;
  /** Lesson `n` (1..7). */
  onOpenLesson: (n: number) => void;
  onOpenRankings: () => void;
  onOpenGlossary: () => void;
  /** "Practise the 10 hands": the hand drill (chunk 9.2b). Hidden while absent. */
  onOpenDrill?: (() => void) | undefined;
}

export function LearnIndex({
  onBack,
  onOpenLesson,
  onOpenRankings,
  onOpenGlossary,
  onOpenDrill,
}: LearnIndexProps) {
  const id = useId();
  const main = useRef<HTMLElement>(null);
  useHeadingFocus(main, 'learn');
  return (
    <main ref={main} className={screen.page} data-learn={LEARN_MARKER}>
      <ScreenBar title={W.title} onBack={onBack} />
      <div className={screen.content}>
        <section className={styles.section} aria-labelledby={`${id}-lessons`}>
          <h2 id={`${id}-lessons`} className={screen.sectionTitle}>
            {W.lessons}
          </h2>
          <ol className={styles.entries}>
            {LESSONS.map((lesson, i) => (
              <li key={lesson.key}>
                {/* Seen as a numbered row, read as "Lesson 3: Your options" (the name holds the
                    words on the button, WCAG 2.5.3). */}
                <button
                  type="button"
                  className={styles.entry}
                  aria-label={W.lessonName(i + 1, lesson.title)}
                  onClick={() => onOpenLesson(i + 1)}
                  data-lesson={lesson.key}
                >
                  <span className={styles.num}>{i + 1}</span>
                  <span className={styles.entryTitle}>{lesson.title}</span>
                  <ChevronLeftIcon />
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.section} aria-labelledby={`${id}-more`}>
          <h2 id={`${id}-more`} className={screen.sectionTitle}>
            {W.more}
          </h2>
          <ul className={styles.entries}>
            <Entry title={W.rankings} hint={W.rankingsHint} onClick={onOpenRankings} />
            <Entry title={W.glossary} hint={W.glossaryHint} onClick={onOpenGlossary} />
            {onOpenDrill && <Entry title={W.drill} onClick={onOpenDrill} />}
          </ul>
        </section>
      </div>
    </main>
  );
}

export interface LessonPageProps {
  /** The lesson, 1..7 (another number shows lesson 1). */
  n: number;
  onBack: () => void;
  /** Next: lesson `n` (the store changes the lesson in place). */
  onOpenLesson: (n: number) => void;
  /** The last lesson's "All lessons". */
  onOpenList: () => void;
  /** Lesson 4's "See all poker hands". */
  onOpenRankings: () => void;
}

export function LessonPage({
  n,
  onBack,
  onOpenLesson,
  onOpenList,
  onOpenRankings,
}: LessonPageProps) {
  const at = n >= 1 && n <= LESSONS.length ? n : 1;
  const lesson = LESSONS[at - 1] as (typeof LESSONS)[number];
  const next = LESSONS[at];
  const main = useRef<HTMLElement>(null);
  useHeadingFocus(main, at);
  return (
    <main ref={main} className={screen.page} data-learn={LEARN_MARKER} data-lesson={lesson.key}>
      <ScreenBar title={lesson.title} onBack={onBack} />
      <div className={screen.content}>
        <p className={styles.lessonOf}>{W.lessonOf(at, LESSONS.length)}</p>
        <LessonView key={at} lesson={lesson} />
        {lesson.link === 'rankings' && (
          <button type="button" className={screen.secondary} onClick={() => onOpenRankings()}>
            {W.seeRankings}
          </button>
        )}
        {next !== undefined ? (
          <button type="button" className={screen.primary} onClick={() => onOpenLesson(at + 1)}>
            {W.next(next.title)}
          </button>
        ) : (
          <button type="button" className={screen.secondary} onClick={() => onOpenList()}>
            {W.allLessons}
          </button>
        )}
      </div>
    </main>
  );
}

/** The full-page hand rankings (§13, with the row details), and "Which hand wins?" always. */
export function HandRankingsPage({ onBack }: { onBack: () => void }) {
  const main = useRef<HTMLElement>(null);
  useHeadingFocus(main, 'handRankings');
  return (
    <main ref={main} className={screen.page} data-learn={LEARN_MARKER}>
      <ScreenBar title={W.rankings} onBack={onBack} />
      <div className={screen.content}>
        <p className={screen.hint}>{W.rankingsHint}</p>
        <RankingsList hero={null} cardSize="md" whichWins />
      </div>
    </main>
  );
}

export function GlossaryPage({ onBack }: { onBack: () => void }) {
  const main = useRef<HTMLElement>(null);
  useHeadingFocus(main, 'glossary');
  return (
    <main ref={main} className={screen.page} data-learn={LEARN_MARKER}>
      <ScreenBar title={W.glossary} onBack={onBack} />
      <div className={screen.content}>
        <GlossaryList rows={enCoach.glossary} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Wired to the store

/** The Learn page `page`, wired to the store (App renders it for each of the four screens). */
export function LearnRoute({ page }: { page: LearnPage }) {
  const dispatch = useDispatch();
  const lesson = useAppStore(selectLesson);
  const back = useCallback(() => dispatch({ type: 'back' }), [dispatch]);
  const openLesson = useCallback(
    (n: number) => dispatch({ type: 'lesson', lesson: n }),
    [dispatch],
  );
  const openRankings = useCallback(
    () => dispatch({ type: 'go', screen: 'handRankings' }),
    [dispatch],
  );
  switch (page) {
    case 'learn':
      return (
        <LearnIndex
          onBack={back}
          onOpenLesson={openLesson}
          onOpenRankings={openRankings}
          onOpenGlossary={() => dispatch({ type: 'go', screen: 'glossary' })}
          // Chunk 9.2b (the hand drill page) passes its way in here.
        />
      );
    case 'lesson':
      return (
        <LessonPage
          n={lesson}
          onBack={back}
          onOpenLesson={openLesson}
          onOpenList={() => dispatch({ type: 'go', screen: 'learn' })}
          onOpenRankings={openRankings}
        />
      );
    case 'handRankings':
      return <HandRankingsPage onBack={back} />;
    case 'glossary':
      return <GlossaryPage onBack={back} />;
  }
}
