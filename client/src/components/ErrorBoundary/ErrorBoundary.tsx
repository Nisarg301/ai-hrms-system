import { Button, Result } from 'antd';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle="An unexpected error occurred. Reloading usually fixes it."
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
