// Minimal types for the dev-only oracle `pokersolver` 2.1.4 (it ships none).
declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    /** 1 = high card … 9 = straight flush (the royal flush is 9, descr "Royal Flush"). */
    rank: number;
    name: string;
    descr: string;
  }
  const pokersolver: { Hand: typeof Hand };
  export default pokersolver;
}
