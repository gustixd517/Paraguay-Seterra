import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Session, MODES, shuffle, formatTime } = require("../game.js");

function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDepartments(count = 17) {
  return Array.from({ length: count }, (_, index) => ({
    id: `dept-${index}`,
    name: `Departamento ${index}`,
    capital: `Capital ${index}`,
  }));
}

test("la partida arranca con los 17 departamentos y una pregunta válida", () => {
  const departments = makeDepartments();
  const session = new Session(departments, "departamentos", seededRandom(7));
  const current = session.start();

  assert.ok(current);
  assert.equal(session.total, 17);
  assert.equal(session.queue.length, 16);
  assert.equal(session.mastered.size, 0);
  assert.equal(session.finished, false);
});

test("completar las 17 respuestas correctas termina la partida con 100%", () => {
  const session = new Session(makeDepartments(), "departamentos", seededRandom(11));
  session.start();
  let guard = 0;

  while (!session.finished && guard < 100) {
    const current = session.current();
    assert.ok(current, "debe haber una pregunta activa");
    const result = session.answer(current.department.id);
    assert.equal(result.correct, true);
    if (!result.finished) session.next();
    guard += 1;
  }

  const stats = session.stats();
  assert.equal(stats.mastered, 17);
  assert.equal(stats.firstTry, 17);
  assert.equal(stats.errors, 0);
  assert.equal(stats.accuracy, 100);
  assert.equal(stats.missed.length, 0);
  assert.equal(session.finished, true);
  assert.equal(session.current(), null);
});

test("un fallo reencola el departamento y baja la precisión a 16/17", () => {
  const session = new Session(makeDepartments(), "departamentos", seededRandom(3));
  const first = session.start();
  const wrongId = session.queue.find((id) => id !== first.department.id);
  const wrong = session.answer(wrongId);

  assert.equal(wrong.correct, false);
  assert.equal(wrong.requeued, true);
  assert.equal(session.errors, 1);
  assert.equal(session.missed.has(first.department.id), true);
  assert.equal(session.queue[3], first.department.id, "se reencola en la posición 3");

  session.next();
  let guard = 0;
  while (!session.finished && guard < 100) {
    const current = session.current();
    const result = session.answer(current.department.id);
    assert.equal(result.correct, true);
    if (!result.finished) session.next();
    guard += 1;
  }

  const stats = session.stats();
  assert.equal(stats.mastered, 17);
  assert.equal(stats.firstTry, 16);
  assert.equal(stats.errors, 1);
  assert.equal(stats.accuracy, 94);
  assert.equal(stats.missed.length, 1);
  assert.equal(stats.missed[0].id, first.department.id);
});

test("el modo de elección genera 4 capitales distintas e incluye la correcta", () => {
  const departments = makeDepartments();
  const session = new Session(departments, "eleccion", seededRandom(21));
  const current = session.start();

  assert.equal(current.options.length, 4);
  const ids = new Set(current.options.map((option) => option.id));
  const labels = new Set(current.options.map((option) => option.label));
  assert.equal(ids.size, 4);
  assert.equal(labels.size, 4);
  assert.equal(ids.has(current.department.id), true);

  const wrongOption = current.options.find((option) => option.id !== current.department.id);
  const wrong = session.answer(wrongOption.id);
  assert.equal(wrong.correct, false);
  assert.equal(session.errors, 1);

  session.next();
  const retry = session.current();
  const right = session.answer(retry.department.id);
  assert.equal(right.correct, true);
  assert.ok(session.byId.has(right.expected.id));
});

test("no se aceptan respuestas fuera de la pregunta activa", () => {
  const session = new Session(makeDepartments(), "departamentos", seededRandom(5));
  session.start();
  const first = session.current();
  session.answer(first.department.id);
  assert.equal(session.answer(first.department.id), null);
  assert.equal(session.answer("no-existe"), null);
});

test("el barajado es determinista con la misma semilla", () => {
  const items = Array.from({ length: 17 }, (_, index) => index);
  const a = shuffle(items, seededRandom(99));
  const b = shuffle(items, seededRandom(99));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, items);
  assert.deepEqual([...a].sort((x, y) => x - y), items);
});

test("formatTime formatea segundos, minutos y horas", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(1000), "00:01");
  assert.equal(formatTime(61_000), "01:01");
  assert.equal(formatTime(3_600_000), "1:00:00");
  assert.equal(formatTime(3_725_000), "1:02:05");
  assert.equal(formatTime(-10), "00:00");
});

test("los tres modos existen y tienen textos", () => {
  assert.deepEqual(Object.keys(MODES).sort(), ["capitales", "departamentos", "eleccion"]);
  for (const mode of Object.values(MODES)) {
    assert.ok(mode.headline.length > 0);
    assert.ok(mode.description.length > 0);
  }
});
