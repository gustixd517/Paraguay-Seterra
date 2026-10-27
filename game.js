/* Lógica pura del juego. Sin DOM, para poder probarla con Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PyGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MODES = Object.freeze({
    departamentos: {
      id: "departamentos",
      name: "Departamentos",
      headline: "Ubica el departamento",
      description: "Te damos el nombre y marcás la región en el mapa.",
    },
    capitales: {
      id: "capitales",
      name: "Capitales",
      headline: "Ubica la capital",
      description: "Te damos una capital y marcás su departamento.",
    },
    eleccion: {
      id: "eleccion",
      name: "Capitales",
      headline: "Elige la capital",
      description: "Se ilumina un departamento y elegís su capital.",
    },
  });

  function shuffle(items, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  function buildOptions(target, departments, rng) {
    if (!target) throw new Error("Falta el departamento objetivo.");
    const others = shuffle(
      departments.filter((item) => item.id !== target.id),
      rng
    ).slice(0, 3);
    return shuffle([target, ...others], rng).map((item) => ({
      id: item.id,
      label: item.capital,
    }));
  }

  class Session {
    constructor(departments, mode, rng) {
      if (!Array.isArray(departments) || departments.length < 4) {
        throw new Error("Se necesitan al menos 4 departamentos.");
      }
      if (!MODES[mode]) throw new Error(`Modo desconocido: ${mode}`);

      this.departments = departments.slice();
      this.byId = new Map(departments.map((item) => [item.id, item]));
      this.mode = mode;
      this.rng = typeof rng === "function" ? rng : Math.random;
      this.total = this.departments.length;
      this.queue = shuffle(
        this.departments.map((item) => item.id),
        this.rng
      );
      this.mastered = new Set();
      this.missed = new Set();
      this.firstTry = new Set();
      this.errors = 0;
      this.currentId = null;
      this.options = null;
      this.finished = false;
      this.questionsShown = 0;
    }

    start() {
      return this.next();
    }

    next() {
      if (this.mastered.size >= this.total) {
        this.finished = true;
        this.currentId = null;
        this.options = null;
        return null;
      }

      while (this.queue.length && this.mastered.has(this.queue[0])) {
        this.queue.shift();
      }
      if (this.queue.length === 0) {
        this.queue = shuffle(
          this.departments.map((item) => item.id).filter((id) => !this.mastered.has(id)),
          this.rng
        );
      }

      this.currentId = this.queue.shift();
      this.questionsShown += 1;
      this.options =
        this.mode === "eleccion"
          ? buildOptions(this.byId.get(this.currentId), this.departments, this.rng)
          : null;
      return this.current();
    }

    current() {
      if (!this.currentId) return null;
      return {
        department: this.byId.get(this.currentId),
        options: this.options,
      };
    }

    answer(id) {
      if (this.finished || !this.currentId || !this.byId.has(id)) return null;

      const expected = this.byId.get(this.currentId);
      const correct = id === this.currentId;

      if (correct) {
        this.mastered.add(this.currentId);
        if (!this.missed.has(this.currentId)) this.firstTry.add(this.currentId);
      } else {
        this.errors += 1;
        this.missed.add(this.currentId);
        // Se vuelve a preguntar después de hasta tres preguntas.
        const insertAt = Math.min(3, this.queue.length);
        this.queue.splice(insertAt, 0, this.currentId);
      }

      const result = {
        correct,
        expected,
        selected: this.byId.get(id) || null,
        finished: this.mastered.size >= this.total,
        requeued: !correct,
      };

      this.finished = result.finished;
      this.currentId = null;
      this.options = null;
      return result;
    }

    stats() {
      const firstTry = this.firstTry.size;
      return {
        total: this.total,
        mastered: this.mastered.size,
        firstTry,
        errors: this.errors,
        accuracy: this.total ? Math.round((firstTry / this.total) * 100) : 0,
        missed: Array.from(this.missed)
          .map((id) => this.byId.get(id))
          .filter(Boolean),
      };
    }

    progress() {
      return this.total ? this.mastered.size / this.total : 0;
    }

    countMissed(id) {
      return this.missed.has(id);
    }
  }

  return { MODES, Session, shuffle, formatTime, buildOptions };
});
