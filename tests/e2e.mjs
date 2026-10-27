/**
 * Prueba de humo E2E contra una instancia de Chrome/Edge con --remote-debugging-port.
 *
 * Uso:
 *   1. Abrir Chrome o Edge headless en el puerto 9333 (ver README).
 *   2. node tests/e2e.mjs
 *
 * No usa dependencias externas: WebSocket y fetch son nativos de Node 24.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CDP_PORT || 9333);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = `file:///${ROOT.replace(/\\/g, "/")}/index.html`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class CDP {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.errors = [];
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      this.events.push(message);
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.text || "Excepción JS");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(
          message.params.args.map((arg) => arg.value || arg.description || "").join(" ")
        );
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        this.errors.push(message.params.entry.text);
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || "Error al evaluar en la página");
    }
    return response.result.value;
  }

  async screenshot(name) {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    const path = join(ROOT, "tools", name);
    writeFileSync(path, Buffer.from(result.data, "base64"));
    console.log(`   captura: tools/${name}`);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* nada */
    }
  }
}

async function waitFor(check, { timeout = 6000, interval = 100, label = "condición" } = {}) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`Tiempo agotado esperando ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((response) => response.json());
  console.log(`Conectado a ${version.Browser}`);

  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());

  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evaluate = (expression) => cdp.evaluate(expression);
  const state = () =>
    evaluate(`(() => {
      const feedback = document.querySelector("#game-feedback");
      return {
        screen: document.body.dataset.screen,
        prompt: (document.querySelector("#game-prompt") || {}).textContent?.trim() || "",
        feedbackHidden: feedback ? feedback.hidden : true,
        feedbackText: feedback ? feedback.textContent.trim() : "",
        timer: (document.querySelector("#game-timer") || {}).textContent || ""
      };
    })()`);

  async function waitApp() {
    await waitFor(
      async () =>
        (await evaluate(
          "document.readyState === 'complete' && document.querySelectorAll('#home-map .dept').length === 17"
        )) === true,
      { label: "que cargue la aplicación" }
    );
  }

  async function navigate(hash) {
    await evaluate(`window.location.hash = ${JSON.stringify(hash)}; true`);
    await waitFor(
      async () => {
        const current = await state();
        return hash === "#/estudiar" ? current.screen === "study" : current.screen === "game";
      },
      { label: `la pantalla de ${hash}` }
    );
  }

  async function currentTargetId() {
    const prompt = (await state()).prompt;
    return evaluate(`(() => {
      const prompt = ${JSON.stringify(prompt)};
      const dept = window.PARAGUAY_DATA.departments.find(
        (item) => item.name === prompt || item.capital === prompt
      );
      return dept ? dept.id : null;
    })()`);
  }

  async function anyOtherId(id) {
    return evaluate(`(() => {
      const dept = window.PARAGUAY_DATA.departments.find((item) => item.id !== ${JSON.stringify(id)});
      return dept ? dept.id : null;
    })()`);
  }

  async function clickSelector(selector) {
    const clicked = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
    assert(clicked, `No se encontró ${selector}`);
  }

  async function waitAfterAnswer() {
    await waitFor(
      async () => {
        const current = await state();
        return current.screen === "results" || current.screen === "study" || current.feedbackHidden;
      },
      { timeout: 5000, label: "que avance la pregunta" }
    );
  }

  async function playAll({ mode, wrongOnce = false }) {
    await navigate(`#/jugar/${mode}`);
    let wrongTargetName = null;
    let guard = 0;

    if (wrongOnce) {
      const target = await currentTargetId();
      assert(target, "No se pudo identificar el departamento de la primera pregunta");
      const other = await anyOtherId(target);
      wrongTargetName = await evaluate(
        `window.PARAGUAY_DATA.departments.find((item) => item.id === ${JSON.stringify(target)}).name`
      );
      await clickSelector(`#game-map .dept[data-id="${other}"]`);
      await waitFor(async () => (await state()).feedbackHidden === false, {
        label: "el feedback del error",
      });
      const feedback = (await state()).feedbackText;
      assert(feedback.includes("Era"), `Feedback de error inesperado: ${feedback}`);
      assert(feedback.includes(wrongTargetName), `El feedback no nombra ${wrongTargetName}`);
      await waitAfterAnswer();
    }

    while (guard < 60) {
      guard += 1;
      const current = await state();
      if (current.screen === "results") break;
      if (current.screen !== "game") throw new Error(`Pantalla inesperada: ${current.screen}`);
      if (!current.feedbackHidden) {
        await waitAfterAnswer();
        continue;
      }

      const target = await currentTargetId();
      assert(target, `No se pudo resolver la pregunta: ${current.prompt}`);
      if (mode === "eleccion") {
        await clickSelector(`#choice-options .choice-button[data-id="${target}"]`);
      } else {
        await clickSelector(`#game-map .dept[data-id="${target}"]`);
      }
      await waitFor(async () => (await state()).feedbackHidden === false, {
        label: "el feedback de la respuesta",
      });
      await waitAfterAnswer();
    }

    await waitFor(async () => (await state()).screen === "results", {
      timeout: 5000,
      label: "la pantalla de resultados",
    });

    return {
      wrongTargetName,
      result: await evaluate(`(() => ({
        time: document.querySelector("#result-time").textContent,
        firstTry: document.querySelector("#result-firsttry").textContent,
        errors: document.querySelector("#result-errors").textContent,
        accuracy: document.querySelector("#result-accuracy").textContent,
        record: document.querySelector("#result-record").textContent.trim(),
        missed: [...document.querySelectorAll("#result-missed li")].map((item) => item.textContent),
        subtitle: document.querySelector("#results-subtitle").textContent
      }))()`),
    };
  }

  try {
    await cdp.send("Page.navigate", { url: BASE });
    await waitApp();
    await evaluate("localStorage.clear(); true");
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitApp();

    console.log("1. Inicio y mapas");
    assert(
      (await evaluate("document.querySelectorAll('#study-map .dept').length")) === 17,
      "El mapa de estudio no tiene 17 departamentos"
    );
    assert(
      (await evaluate("document.querySelectorAll('#home-map .dept').length")) === 17,
      "El mapa de inicio no tiene 17 departamentos"
    );

    console.log("2. Estudio: ficha, selección y capitales");
    await navigate("#/estudiar");
    await clickSelector('.study-row[data-id="boqueron"]');
    await waitFor(
      async () =>
        (await evaluate(
          "document.querySelector('#study-detail h2').textContent === 'Boquerón'"
        )) === true,
      { label: "la ficha de Boquerón" }
    );
    const studyDetail = await evaluate(`(() => ({
      title: document.querySelector("#study-detail h2").textContent,
      capital: document.querySelector("#study-detail .detail-card__capital").textContent,
      number: document.querySelector("#study-detail .detail-card__number")?.textContent || null,
      rowNumber: document.querySelector('.study-row[data-id="boqueron"] .study-row__number')?.textContent || null,
      selected: document.querySelector("#study-map .dept.is-selected")?.dataset.id || null
    }))()`);
    assert(studyDetail.capital === "Filadelfia", "La ficha no muestra la capital correcta");
    assert(studyDetail.number === "N.º 16", `Número en ficha inesperado: ${studyDetail.number}`);
    assert(studyDetail.rowNumber === "16", `Número en lista inesperado: ${studyDetail.rowNumber}`);
    assert(studyDetail.selected === "boqueron", "El mapa no resalta Boquerón");

    const dotsBefore = await evaluate(
      "document.querySelectorAll('#study-map .capital-dot:not(.is-hidden)').length"
    );
    await clickSelector("#show-capitals");
    await waitFor(
      async () =>
        (await evaluate(
          "document.querySelectorAll('#study-map .capital-dot:not(.is-hidden)').length"
        )) === 0,
      { label: "ocultar los puntos de capitales" }
    );
    await clickSelector("#show-capitals");
    await waitFor(
      async () =>
        (await evaluate(
          "document.querySelectorAll('#study-map .capital-dot:not(.is-hidden)').length"
        )) === dotsBefore,
      { label: "volver a mostrar los puntos de capitales" }
    );
    await cdp.screenshot("e2e-study.png");

    console.log("3. Partida de departamentos con un error");
    const departmentsRun = await playAll({ mode: "departamentos", wrongOnce: true });
    assert(departmentsRun.result.errors === "1", `Errores: ${departmentsRun.result.errors}`);
    assert(departmentsRun.result.firstTry === "16/17", `A la primera: ${departmentsRun.result.firstTry}`);
    assert(departmentsRun.result.accuracy === "94%", `Precisión: ${departmentsRun.result.accuracy}`);
    assert(
      departmentsRun.result.missed.some((item) => item.includes(departmentsRun.wrongTargetName)),
      "La lista de repaso no incluye el fallo"
    );
    assert(
      departmentsRun.result.record.includes("sin errores"),
      "El récord de una partida con errores no debería guardarse"
    );
    await cdp.screenshot("e2e-results.png");

    console.log("4. Partida de capitales sin errores");
    const capitalsRun = await playAll({ mode: "capitales" });
    assert(capitalsRun.result.errors === "0", `Errores: ${capitalsRun.result.errors}`);
    assert(capitalsRun.result.firstTry === "17/17", `A la primera: ${capitalsRun.result.firstTry}`);
    assert(capitalsRun.result.accuracy === "100%", `Precisión: ${capitalsRun.result.accuracy}`);

    console.log("5. Partida de opciones sin errores");
    const choiceRun = await playAll({ mode: "eleccion" });
    assert(choiceRun.result.errors === "0", `Errores: ${choiceRun.result.errors}`);
    assert(choiceRun.result.firstTry === "17/17", `A la primera: ${choiceRun.result.firstTry}`);
    assert(choiceRun.result.accuracy === "100%", `Precisión: ${choiceRun.result.accuracy}`);
    assert(choiceRun.result.record.length > 0, "No se mostró el récord");
    await cdp.screenshot("e2e-results-clean.png");

    console.log("6. Asunción no cuenta como error");
    await navigate("#/jugar/departamentos");
    await clickSelector("#game-map .district");
    let toast = "";
    await waitFor(
      async () => {
        toast = (await evaluate("document.querySelector('#toast').textContent")) || "";
        return Boolean(toast);
      },
      { label: "el aviso de Asunción" }
    );
    assert(toast.includes("Asunción"), `Aviso inesperado: ${toast}`);
    assert(
      (await evaluate("document.querySelector('#game-errors').textContent")) === "0",
      "Asunción no debe contar como error"
    );

    console.log("7. Inicio, récord y ayuda");
    await evaluate("window.location.hash = '#/'; true");
    await waitFor(async () => (await state()).screen === "home", { label: "volver al inicio" });
    const bestCapitales = await evaluate(
      "document.querySelector('[data-best=\"capitales\"]').textContent"
    );
    assert(bestCapitales.startsWith("Récord"), `Récord no visible en inicio: ${bestCapitales}`);
    await clickSelector("#help-button");
    await waitFor(
      async () => (await evaluate("document.querySelector('#help-dialog').open")) === true,
      { label: "abrir la ayuda" }
    );
    await cdp.screenshot("e2e-help.png");
    await clickSelector("[data-close-help]");

    console.log("8. Consola");
    const relevantErrors = cdp.errors.filter(
      (message) => !/favicon|AudioContext|autoplay/i.test(message)
    );
    assert(relevantErrors.length === 0, `Errores de consola:\n${relevantErrors.join("\n")}`);

    console.log("\nOK: flujo completo verificado.");
    console.log(JSON.stringify({ departmentsRun, capitalsRun, choiceRun, studyDetail }, null, 2));
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error("\nFALLO:", error.message);
  process.exitCode = 1;
});
