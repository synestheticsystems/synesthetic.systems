import { Component, type ReactNode } from 'react';

// Keeps a crash in the WebGL hero from taking down the whole page: on error it
// renders the provided fallback (the static CSS gradient) instead.
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Hero field crashed; showing static fallback.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
