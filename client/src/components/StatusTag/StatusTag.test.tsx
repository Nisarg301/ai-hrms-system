import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
  it('renders the active status', () => {
    render(<StatusTag status="active" />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders the disabled status', () => {
    render(<StatusTag status="disabled" />);
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('renders the inactive status with the neutral tint', () => {
    render(<StatusTag status="inactive" />);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('renders the archived status with the neutral tint', () => {
    render(<StatusTag status="archived" />);
    expect(screen.getByText('archived')).toBeInTheDocument();
  });

  it('renders the planning status with the neutral tint', () => {
    render(<StatusTag status="planning" />);
    expect(screen.getByText('planning')).toBeInTheDocument();
  });

  it('renders the completed status with the neutral tint', () => {
    render(<StatusTag status="completed" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders the on-hold status with the neutral tint', () => {
    render(<StatusTag status="on-hold" />);
    expect(screen.getByText('on-hold')).toBeInTheDocument();
  });

  it('renders the todo status with the neutral tint', () => {
    render(<StatusTag status="todo" />);
    expect(screen.getByText('todo')).toBeInTheDocument();
  });

  it('renders the in-progress status with the neutral tint', () => {
    render(<StatusTag status="in-progress" />);
    expect(screen.getByText('in-progress')).toBeInTheDocument();
  });

  it('renders the done status with the neutral tint', () => {
    render(<StatusTag status="done" />);
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('renders the blocked status with the neutral tint', () => {
    render(<StatusTag status="blocked" />);
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });
});
