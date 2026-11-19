type Listener<T> = (state: T, prev: T) => void;

export interface Store<T extends object> {
  get(): Readonly<T>;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------- 使用 ----------
interface Todo {
  id: number;
  title: string;
  done: boolean;
}

type Filter = 'all' | 'active' | 'done';

const store = createStore({ todos: [] as Todo[], filter: 'all' as Filter });

export const visibleTodos = (): Todo[] => {
  const { todos, filter } = store.get();
  const predicates: Record<Filter, (t: Todo) => boolean> = {
    all: () => true,
    active: (t) => !t.done,
    done: (t) => t.done,
  };
  return todos.filter(predicates[filter]);
};

export function toggle(id: Todo['id']): void {
  store.set(({ todos }) => ({
    todos: todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
  }));
}
