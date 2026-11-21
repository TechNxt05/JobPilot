import { Component, type ReactNode } from "react";

/**
 * Keeps one broken part of the panel from blanking all of it: shows what went wrong, with a way to retry.
 * `compact` is for a single card; the full version wraps the whole panel.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; compact?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`JobPilot ${this.props.label ?? "panel"} error:`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card error">
        <strong>{this.props.compact ? `${this.props.label ?? "This section"} hit an error.` : "JobPilot hit an error."}</strong>
        <p className="small mono">{error.message || String(error)}</p>
        <div className="row gap">
          <button className="btn small" onClick={() => this.setState({ error: null })}>Try again</button>
          {!this.props.compact && <button className="btn small ghost" onClick={() => location.reload()}>Reload panel</button>}
        </div>
      </div>
    );
  }
}
