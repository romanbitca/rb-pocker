/** Builders for view models in the UI tests. */
import type { SeatPlace } from '../../src/ui/components/Seat.tsx';
import type { SeatView } from '../../src/ui/views.ts';

export function seatView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    seat: 3,
    name: 'Anna',
    personality: 'rock',
    stack: 1250,
    bet: 50,
    dealer: false,
    blind: null,
    folded: false,
    allIn: false,
    toAct: false,
    lastAction: null,
    cards: { kind: 'hidden' },
    winner: false,
    ...overrides,
  };
}

export const PLACE: SeatPlace = {
  pod: { x: 10, y: 20, w: 64, h: 72 },
  bet: { x: 77, y: 60, w: 56, h: 20 },
  inner: 'right',
};
