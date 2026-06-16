import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode; name: string; fallback?: ReactNode; context?: Record<string, unknown> },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[error-boundary]', {
      component: this.props.name,
      error,
      info,
      context: this.props.context
    });
  }

  componentDidUpdate(prevProps: { name: string }) {
    if (prevProps.name !== this.props.name && this.state.error) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback || (
        <div className="panel error-boundary">
          <h2>Something broke in {this.props.name}</h2>
          <p className="error">{this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: undefined })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
