import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** If true, shows a smaller inline error instead of full-page */
  inline?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      if (this.props.inline) {
        return (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-4 m-4">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Something went wrong</h3>
            <p className="text-sm text-red-600 dark:text-red-300 mt-1">{this.state.error?.message}</p>
            <button
              className="mt-2 text-sm text-red-700 dark:text-red-400 underline hover:text-red-900 dark:hover:text-red-200"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        );
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-muted/30" data-testid="error-boundary-fallback">
          <div className="text-center p-8 max-w-md">
            <div className="text-6xl mb-4">⚠</div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <div className="space-x-3">
              <button
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try Again
              </button>
              <button
                className="bg-muted text-muted-foreground px-4 py-2 rounded-md hover:bg-muted/80"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
