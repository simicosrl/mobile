import { Component } from 'react';

// A blank white screen with no visible error is the worst failure mode for
// an app operators rely on all shift — this boundary turns any render-time
// crash into a readable, screenshot-able panel instead.
export default class ErrorBoundary extends Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0F172A',
          color: '#fff',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12,
          padding: 16,
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
          Something went wrong
        </div>
        <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12.5, color: '#94A3B8', marginBottom: 14, lineHeight: 1.5 }}>
          Please screenshot this screen and send it back — it tells us exactly what broke.
        </div>
        <div style={{ background: '#1F242D', borderRadius: 10, padding: 12, marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {String(error?.stack || error?.message || error)}
        </div>
        {info?.componentStack && (
          <div style={{ background: '#1F242D', borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#94A3B8' }}>
            {info.componentStack}
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            minHeight: 44,
            width: '100%',
            border: 0,
            borderRadius: 10,
            background: '#1F6FEB',
            color: '#fff',
            fontFamily: 'Manrope, sans-serif',
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
