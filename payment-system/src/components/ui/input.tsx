import React from 'react';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', type = 'text', error = false, ...props }, ref) => {
    const baseStyles = 'flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm';
    const focusStyles = 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';
    const errorStyles = error 
      ? 'border-red-500 focus:ring-red-500' 
      : 'border-gray-200';
    const disabledStyles = 'disabled:cursor-not-allowed disabled:opacity-50';

    return (
      <input
        type={type}
        className={`${baseStyles} ${focusStyles} ${errorStyles} ${disabledStyles} ${className}`}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
