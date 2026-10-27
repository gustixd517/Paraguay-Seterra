import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const data = require("../map-data.js");

test("el mapa contiene 17 departamentos y Asunción aparte", () => {
  assert.equal(data.departments.length, 17);
  assert.equal(data.district.name, "Asunción");
  assert.equal(data.departments.some((dept) => dept.id === "asuncion"), false);
});

test("todos los pares departamento-capital son únicos y están completos", () => {
  const ids = new Set(data.departments.map((dept) => dept.id));
  const names = new Set(data.departments.map((dept) => dept.name));
  const capitals = new Set(data.departments.map((dept) => dept.capital));
  assert.equal(ids.size, 17);
  assert.equal(names.size, 17);
  assert.equal(capitals.size, 17);

  const expected = new Map([
    ["Alto Paraguay", "Fuerte Olimpo"],
    ["Alto Paraná", "Ciudad del Este"],
    ["Amambay", "Pedro Juan Caballero"],
    ["Boquerón", "Filadelfia"],
    ["Caaguazú", "Coronel Oviedo"],
    ["Caazapá", "Caazapá"],
    ["Canindeyú", "Salto del Guairá"],
    ["Central", "Areguá"],
    ["Concepción", "Concepción"],
    ["Cordillera", "Caacupé"],
    ["Guairá", "Villarrica"],
    ["Itapúa", "Encarnación"],
    ["Misiones", "San Juan Bautista"],
    ["Ñeembucú", "Pilar"],
    ["Paraguarí", "Paraguarí"],
    ["Presidente Hayes", "Villa Hayes"],
    ["San Pedro", "San Pedro del Ycuamandiyú"],
  ]);

  for (const dept of data.departments) {
    assert.equal(dept.capital, expected.get(dept.name), `capital de ${dept.name}`);
    assert.ok(dept.name.normalize("NFC") === dept.name, "nombre en NFC");
  }
  assert.ok(
    data.departments.some((dept) => dept.name === "Ñeembucú"),
    "conserva la Ñ"
  );
});

test("la numeración departamental nacional va del 1 al 17", () => {
  const numbers = data.departments.map((dept) => dept.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 17 }, (_, index) => index + 1));

  const byName = new Map(data.departments.map((dept) => [dept.name, dept.number]));
  assert.equal(byName.get("Concepción"), 1);
  assert.equal(byName.get("Central"), 11);
  assert.equal(byName.get("Boquerón"), 16);
  assert.equal(byName.get("Alto Paraguay"), 17);
  assert.equal(data.district.number, undefined, "Asunción no tiene número departamental");
});

test("las regiones suman 3 occidentales y 14 orientales", () => {
  const occidental = data.departments.filter((dept) => dept.region === "occidental");
  const oriental = data.departments.filter((dept) => dept.region === "oriental");
  assert.equal(occidental.length, 3);
  assert.equal(oriental.length, 14);
  assert.deepEqual(
    occidental.map((dept) => dept.name).sort(),
    ["Alto Paraguay", "Boquerón", "Presidente Hayes"]
  );
});

test("las superficies suman la superficie continental aproximada", () => {
  const total = data.departments.reduce((sum, dept) => sum + dept.areaKm2, 0);
  assert.ok(total > 405_000 && total < 408_000, `superficie total: ${total}`);
});

test("todos los paths son polígonos cerrados y no están vacíos", () => {
  for (const dept of data.departments) {
    assert.ok(dept.path.startsWith("M"), `${dept.name}: comienza con M`);
    assert.ok(dept.path.endsWith("Z"), `${dept.name}: cierra el polígono`);
    assert.ok(dept.path.length > 100, `${dept.name}: tiene geometría suficiente`);
    assert.equal((dept.path.match(/M/g) || []).length, 1, `${dept.name}: un anillo`);
  }
  assert.ok(data.district.path.startsWith("M"));
  assert.ok(data.district.path.endsWith("Z"));
});

test("etiquetas y capitales están dentro del viewBox", () => {
  const all = [...data.departments, data.district];
  for (const item of all) {
    for (const key of ["label", "capitalPoint"]) {
      const point = item[key];
      assert.ok(Array.isArray(point) && point.length === 2, `${item.name}: ${key}`);
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
      assert.ok(point[0] >= 0 && point[0] <= data.width, `${item.name}: x de ${key}`);
      assert.ok(point[1] >= 0 && point[1] <= data.height, `${item.name}: y de ${key}`);
    }
  }
});

test("el mapa conserva una proporción realista y una escala única", () => {
  const ratio = data.width / data.height;
  assert.ok(ratio > 0.9 && ratio < 0.96, `proporción inesperada: ${ratio}`);
  assert.equal(data.projection, "Albers Equal Area");
  assert.equal(data.source.license, "CC BY 4.0");
});

test("las etiquetas no quedan encima de los puntos de capital", () => {
  for (const dept of data.departments) {
    const [lx, ly] = dept.label;
    const [cx, cy] = dept.capitalPoint;
    const distance = Math.hypot(lx - cx, ly - cy);
    assert.ok(distance > 6, `${dept.name}: etiqueta demasiado cerca de la capital (${distance.toFixed(1)})`);
  }
});
