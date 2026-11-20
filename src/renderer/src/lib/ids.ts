// One maker of unique ids (9.2 uplift F141): the time plus a counter plus chance, so two made in the same
// millisecond (a double-clicked "Add a flow") never share one. Chat, attachments and the recorder already
// suffix their own the same way; new ids come from here.
let counter = 0;

/** A unique id with the given prefix ("flow-k3…"): time, a counter and chance, never the time alone. */
export const uniqueId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
