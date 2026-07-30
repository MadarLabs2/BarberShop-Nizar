import React from 'react';

/**
 * Wrapper for use in .map() when the outermost element needs a key.
 * React.Fragment accepts key at runtime but @types/react FragmentProps may not include it.
 * This component explicitly accepts key so TypeScript is satisfied.
 */
interface KeyedProps {
  key?: React.Key;
  children?: React.ReactNode;
}

export function Keyed({ children }: KeyedProps) {
  return <>{children ?? null}</>;
}
