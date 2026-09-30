import { Component, type ErrorInfo, type ReactNode } from 'react'
import { globalErrorHandler } from '../utils/errorHandling'

interface ErrorBoundaryProps {
  children: ReactNode
  onOpenSettings?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    globalErrorHandler('render error', error, false, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="h-full min-h-0 overflow-y-auto bg-bg-000 px-5 pb-40 pt-24 text-text-100">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-2xl border border-danger-100/25 bg-danger-bg/60 p-4 shadow-sm">
            <div className="mb-2 text-[length:var(--fs-lg)] font-semibold text-danger-100">
              OpenCode UI ran into a problem
            </div>
            <div className="text-[length:var(--fs-sm)] leading-relaxed text-text-200">
              {this.state.error.message || 'The chat view could not render this response.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {this.props.onOpenSettings && (
              <button
                type="button"
                onClick={this.props.onOpenSettings}
                className="rounded-lg bg-accent-main-100 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-white hover:bg-accent-main-200"
              >
                Open server settings
              </button>
            )}
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-border-200 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-text-200 hover:bg-bg-200"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-border-200 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-text-200 hover:bg-bg-200"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
