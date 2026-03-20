'use client'

import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children?: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Core Application Error Caught:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{ padding: '24px', border: '1px solid #E85438', backgroundColor: 'rgba(232, 84, 56, 0.1)', color: '#E85438', borderRadius: '4px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px' }}>CRITICAL UI FAILURE</h2>
          <pre style={{ fontSize: '12px', fontFamily: 'monospace' }}>{this.state.error?.message}</pre>
        </div>
      )
    }

    return this.props.children
  }
}
