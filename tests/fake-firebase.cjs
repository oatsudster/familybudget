/* In-memory Firebase substitute for tests and local UI preview only. No network. */
function installFakeFirebase(target, seed = {}) {
  const data = {
    transactions: new Map(
      (seed.transactions || []).map((t) => [t.id, { ...t }]),
    ),
    amwayItems: new Map((seed.amwayItems || []).map((t) => [t.id, { ...t }])),
  };
  const listeners = { transactions: [], amwayItems: [] };
  const state = {
    writes: [],
    delay: 30,
    failNext: false,
    fromCache: false,
    pending: false,
    errors: {},
    data,
  };
  let nextId = 1;
  const snapshot = (kind) => ({
    metadata: { fromCache: state.fromCache, hasPendingWrites: state.pending },
    docs: [...data[kind].entries()].map(([id, value]) => ({
      id,
      data: () => {
        const copy = { ...value };
        delete copy.id;
        return copy;
      },
    })),
  });
  function emit(kind) {
    listeners[kind].forEach((l) =>
      state.errors[kind]
        ? l.error({ code: "permission-denied" })
        : l.next(snapshot(kind)),
    );
  }
  state.emit = () => Object.keys(listeners).forEach(emit);
  function collection(kind) {
    return {
      orderBy() {
        return this;
      },
      onSnapshot(options, next, error) {
        const listener = { next, error };
        listeners[kind].push(listener);
        queueMicrotask(() => {
          if (listeners[kind].includes(listener)) emit(kind);
        });
        return () =>
          (listeners[kind] = listeners[kind].filter((l) => l !== listener));
      },
      doc(id = "test-record-" + nextId++) {
        const write = async (op, value) => {
          state.writes.push({ kind, id, op, value });
          state.pending = true;
          emit(kind);
          await new Promise((resolve) => setTimeout(resolve, state.delay));
          if (state.failNext) {
            state.failNext = false;
            state.pending = false;
            emit(kind);
            throw { code: "unavailable" };
          }
          if (op === "delete") data[kind].delete(id);
          else if (op === "update") {
            if (!data[kind].has(id)) {
              state.pending = false;
              emit(kind);
              throw { code: "not-found" };
            }
            data[kind].set(id, { ...data[kind].get(id), ...value });
          } else data[kind].set(id, { ...value });
          state.pending = false;
          emit(kind);
        };
        return {
          id,
          set: (v) => write("set", v),
          update: (v) => write("update", v),
          delete: () => write("delete"),
        };
      },
    };
  }
  const db = {
    enablePersistence: () => Promise.resolve(),
    collection: (name) => {
      if (name !== "households") throw Error("Unexpected collection");
      return { doc: () => ({ collection }) };
    },
  };
  const firestore = () => db;
  firestore.FieldValue = {
    serverTimestamp: () => ({ toMillis: () => Date.now() }),
  };
  target.firebase = { initializeApp() {}, firestore };
  return state;
}
if (typeof module !== "undefined") module.exports = { installFakeFirebase };
