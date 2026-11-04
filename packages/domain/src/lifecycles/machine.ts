export interface Transition<S extends string, A extends string> {
  from: S | readonly S[] | '*';
  action: A;
  to: S;
  /** Free-form guard description; guards are evaluated by services which own the data. */
  guard?: string;
}

export interface Machine<S extends string, A extends string> {
  name: string;
  states: readonly S[];
  transitions: readonly Transition<S, A>[];
}

const matches = <S extends string>(from: S | readonly S[] | '*', s: S): boolean =>
  from === '*' ? true : Array.isArray(from) ? (from as readonly S[]).includes(s) : from === s;

export function findTransition<S extends string, A extends string>(
  m: Machine<S, A>,
  state: S,
  action: A,
): Transition<S, A> | undefined {
  return m.transitions.find((t) => t.action === action && matches(t.from, state));
}

export function canTransition<S extends string, A extends string>(m: Machine<S, A>, state: S, action: A): boolean {
  return findTransition(m, state, action) !== undefined;
}

export class TransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly state: string,
    public readonly action: string,
  ) {
    super(`${machine}: action '${action}' not allowed from state '${state}'`);
  }
}

export function transition<S extends string, A extends string>(m: Machine<S, A>, state: S, action: A): S {
  const t = findTransition(m, state, action);
  if (!t) throw new TransitionError(m.name, state, action);
  return t.to;
}

/** Actions allowed from a state (feeds `allowedActions[]` in API resources). */
export function allowedActions<S extends string, A extends string>(m: Machine<S, A>, state: S): A[] {
  return [...new Set(m.transitions.filter((t) => matches(t.from, state)).map((t) => t.action))];
}

export const machine = <S extends string, A extends string>(
  name: string,
  states: readonly S[],
  transitions: readonly Transition<S, A>[],
): Machine<S, A> => ({ name, states, transitions });
