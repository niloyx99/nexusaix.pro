import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unknown error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#0d0f12',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, marginBottom: 8 }}>NEXUS AI failed to load</h1>
            <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
              Refresh the page. If this keeps happening, open{' '}
              <strong>http://YOUR-PC-IP:7777</strong> instead of port 8889.
            </p>
            <p style={{ fontSize: 11, opacity: 0.45, wordBreak: 'break-word' }}>
              {this.state.message}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
