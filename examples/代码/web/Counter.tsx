import { useEffect, useReducer, type FC } from 'react';

type Action = { type: 'inc' } | { type: 'dec' } | { type: 'reset'; value: number };

function reducer(count: number, action: Action): number {
  switch (action.type) {
    case 'inc':
      return count + 1;
    case 'dec':
      return Math.max(0, count - 1);
    case 'reset':
      return action.value;
  }
}

interface CounterProps {
  initial?: number;
  label: string;
}

export const Counter: FC<CounterProps> = ({ initial = 0, label }) => {
  const [count, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    document.title = `${label}：${count}`;
  }, [label, count]);

  return (
    <div className="counter">
      <span>{label}</span>
      <button onClick={() => dispatch({ type: 'dec' })} disabled={count === 0}>
        −
      </button>
      <output>{count}</output>
      <button onClick={() => dispatch({ type: 'inc' })}>+</button>
      <button onClick={() => dispatch({ type: 'reset', value: initial })}>重置</button>
    </div>
  );
};
