/**
 * Guards a lazy sheet (React.lazy + Suspense): when its chunk cannot be loaded (for example a
 * browser that dropped the cached file during an app update) or it throws while rendering, the
 * boundary shows nothing and calls `onError` once, so the caller can close the overlay. Without it
 * the error would take the whole app down, or the overlay would stay "open" with nothing on screen
 * and its controller gate shut.
 *
 * A `React.lazy` that failed to load stays failed until the page is reloaded, so the sheet then
 * opens and closes at once on every later tap; the game itself is never stuck.
 */
import { Component, type ReactNode } from 'react';

export interface LoadBoundaryProps {
  /** Called once when the children fail. Pass a stable function. */
  onError: () => void;
  children: ReactNode;
}

interface LoadBoundaryState {
  failed: boolean;
}

export class LoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  override state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
