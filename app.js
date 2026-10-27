/* Paraguay · departamentos y capitales — interfaz y flujo del juego. */
(function () {
  "use strict";

  const data = window.PARAGUAY_DATA;
  const gameLib = window.PyGame;

  if (!data || !gameLib || !Array.isArray(data.departments) || data.departments.length !== 17) {
    document.body.innerHTML =
      '<main style="padding:48px;font-family:system-ui,sans-serif"><h1>No se pudo cargar el mapa</h1><p>Revisá que <code>map-data.js</code> esté junto a <code>index.html</code>.</p></main>';
    return;
  }

  const { Session, MODES, formatTime } = gameLib;
  const NS = "http://www.w3.org/2000/svg";
  const departments = data.departments.slice();
  const deptById = new Map(departments.map((dept) => [dept.id, dept]));
  const districtItem = {
    id: "asuncion",
    name: data.district.name,
    capital: "Capital del país",
    note: data.district.note,
    region: "oriental",
    areaKm2: 117,
  };

  const STORAGE = {
    records: "py-geo:records:v1",
    sound: "py-geo:sound:v1",
    capitals: "py-geo:capitals:v1",
  };

  const MODE_LABELS = {
    departamentos: "Departamentos",
    capitales: "Capitales",
    eleccion: "Elige la capital",
  };

  const PROMPTS = {
    departamentos: {
      kind: "Encuentra el departamento",
      hint: "Hacé clic en la región correcta del mapa.",
    },
    capitales: {
      kind: "Encuentra el departamento cuya capital es",
      hint: "Hacé clic en el departamento al que pertenece esa capital.",
    },
    eleccion: {
      kind: "Elige la capital de",
      hint: "Seleccioná una de las cuatro opciones.",
    },
  };

  const TITLES = {
    home: "Paraguay: departamentos y capitales — Juego de geografía",
    study: "Mapa de estudio · Paraguay",
    game: "Jugando · Paraguay",
    results: "Resultados · Paraguay",
  };

  const state = {
    screen: "home",
    session: null,
    mode: null,
    timerId: null,
    startedAt: 0,
    elapsed: 0,
    locked: true,
    finishing: false,
    advanceTimer: null,
    finishTimer: null,
    toastTimer: null,
    homeHoverId: null,
    studySelected: null,
    studyRows: new Map(),
    showCapitals: true,
    soundOn: true,
    homeMap: null,
    studyMap: null,
    gameMap: null,
    resultsMap: null,
    labelObserver: null,
  };

  const refs = {};

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function regionLabel(region) {
    return region === "occidental" ? "Occidental (Chaco)" : "Oriental";
  }

  const numberFormat = new Intl.NumberFormat("es-PY");

  function formatArea(value) {
    return `${numberFormat.format(value)} km²`;
  }

  function readJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* Sin almacenamiento: la partida sigue funcionando en memoria. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sonido                                                              */
  /* ------------------------------------------------------------------ */

  let audioContext = null;

  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      audioContext = new AudioCtor();
    } catch (error) {
      audioContext = null;
    }
    return audioContext;
  }

  function playTone(frequency, delay, duration, type, volume) {
    if (!state.soundOn) return;
    const context = getAudioContext();
    if (!context) return;
    try {
      if (context.state === "suspended") context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(volume || 0.035, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    } catch (error) {
      /* El audio es un extra, nunca debe romper el juego. */
    }
  }

  function playCorrect() {
    playTone(620, 0, 0.09, "sine", 0.032);
    playTone(880, 0.075, 0.13, "sine", 0.03);
  }

  function playWrong() {
    playTone(190, 0, 0.18, "triangle", 0.04);
    playTone(150, 0.08, 0.16, "triangle", 0.025);
  }

  function playFinish() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      playTone(frequency, index * 0.09, 0.2, "sine", 0.03);
    });
  }

  function playToggle() {
    playTone(520, 0, 0.06, "sine", 0.025);
  }

  function updateSoundUI() {
    refs.soundToggle.setAttribute("aria-pressed", String(state.soundOn));
    refs.soundToggle.setAttribute("aria-label", state.soundOn ? "Desactivar sonido" : "Activar sonido");
  }

  /* ------------------------------------------------------------------ */
  /* Tooltip y avisos                                                    */
  /* ------------------------------------------------------------------ */

  function moveTooltip(event) {
    if (!refs.tooltip) return;
    const margin = Math.min(140, window.innerWidth / 2);
    const x = Math.max(margin, Math.min(window.innerWidth - margin, event.clientX));
    const y = Math.max(92, event.clientY);
    refs.tooltip.style.left = `${x}px`;
    refs.tooltip.style.top = `${y}px`;
  }

  function showTooltip(item, event) {
    if (!event || event.pointerType !== "mouse" || !refs.tooltip) return;
    if (refs.tooltip.dataset.itemId !== item.id) {
      clearNode(refs.tooltip);
      const kicker = document.createElement("span");
      kicker.className = "map-tooltip__kicker";
      kicker.textContent =
        item.id === "asuncion" ? "Distrito Capital" : `Departamento N.º ${item.number}`;
      const name = document.createElement("strong");
      name.textContent = item.name;
      const detail = document.createElement("span");
      detail.textContent =
        item.id === "asuncion" ? "Capital del país · no es un departamento" : `Capital: ${item.capital}`;
      refs.tooltip.append(kicker, name, detail);
      refs.tooltip.dataset.itemId = item.id;
    }
    refs.tooltip.hidden = false;
    moveTooltip(event);
  }

  function hideTooltip() {
    if (!refs.tooltip) return;
    refs.tooltip.hidden = true;
  }

  function showToast(message) {
    if (!refs.toast) return;
    refs.toast.textContent = message;
    refs.toast.hidden = false;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      refs.toast.hidden = true;
    }, 2800);
  }

  function defaultHomeCaption() {
    return window.matchMedia("(hover: none)").matches
      ? "Abrí el mapa de estudio para explorar."
      : "Pasá el cursor para explorar.";
  }

  function setHomeCaption(item) {
    if (!refs.homeCaption) return;
    clearNode(refs.homeCaption);
    const dot = document.createElement("span");
    dot.className = "map-caption__dot";
    dot.setAttribute("aria-hidden", "true");
    refs.homeCaption.appendChild(dot);

    if (!item) {
      refs.homeCaption.appendChild(document.createTextNode(defaultHomeCaption()));
      return;
    }

    if (item.id !== "asuncion") {
      const number = document.createElement("span");
      number.className = "map-caption__number";
      number.textContent = `N.º ${item.number}`;
      refs.homeCaption.append(number, document.createTextNode(" · "));
    }

    const name = document.createElement("strong");
    name.textContent = item.name;
    refs.homeCaption.appendChild(name);
    refs.homeCaption.appendChild(
      document.createTextNode(item.id === "asuncion" ? " · Distrito Capital" : ` · ${item.capital}`)
    );
  }

  function handleHomeHover(item, event) {
    if (state.homeHoverId !== item.id) {
      state.homeHoverId = item.id;
      setHomeCaption(item);
    }
    showTooltip(item, event);
  }

  function handleHomeLeave() {
    state.homeHoverId = null;
    setHomeCaption(null);
    hideTooltip();
  }

  /* ------------------------------------------------------------------ */
  /* Mapa SVG                                                            */
  /* ------------------------------------------------------------------ */

  const SMALL_LABELS = new Set(["central", "cordillera", "guaira", "caazapa", "paraguari"]);
  const TINY_LABELS = new Set();

  function createMap(options) {
    const opts = Object.assign(
      {
        interactive: false,
        labels: false,
        capitals: false,
        districtLabel: false,
        onHover: null,
        onLeave: null,
        onSelect: null,
        onDistrictSelect: null,
        role: "img",
        ariaLabel: "Mapa de Paraguay con sus 17 departamentos",
      },
      options || {}
    );

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${data.width} ${data.height}`);
    svg.setAttribute("width", String(data.width));
    svg.setAttribute("height", String(data.height));
    svg.setAttribute("class", "map-svg");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", opts.role);
    svg.setAttribute("aria-label", opts.ariaLabel);

    const baseGroup = document.createElementNS(NS, "g");
    svg.appendChild(baseGroup);

    const dotsGroup = document.createElementNS(NS, "g");
    dotsGroup.setAttribute("aria-hidden", "true");
    svg.appendChild(dotsGroup);

    const labelsGroup = document.createElementNS(NS, "g");
    labelsGroup.setAttribute("aria-hidden", "true");
    svg.appendChild(labelsGroup);

    const paths = new Map();
    const labels = new Map();
    const dots = new Map();

    function bindElement(element, item, isDistrict) {
      if (opts.onHover) {
        element.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") opts.onHover(item, event);
        });
        element.addEventListener("pointermove", (event) => {
          if (event.pointerType === "mouse") opts.onHover(item, event);
        });
        element.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "mouse" && opts.onLeave) opts.onLeave(item, event);
        });
      }

      if (opts.interactive) {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          const handler = isDistrict ? opts.onDistrictSelect : opts.onSelect;
          if (handler) handler(item.id, item);
        });
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            element.click();
          }
        });
      } else if (isDistrict && opts.onDistrictSelect) {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          opts.onDistrictSelect(item.id, item);
        });
      }
    }

    for (const dept of departments) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", dept.path);
      const pathClasses = ["dept"];
      if (opts.interactive) pathClasses.push("is-interactive");
      if (opts.onHover) pathClasses.push("is-hoverable");
      path.setAttribute("class", pathClasses.join(" "));
      path.dataset.id = dept.id;
      if (opts.interactive) {
        path.setAttribute("tabindex", "0");
        path.setAttribute("focusable", "true");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", dept.name);
        path.setAttribute("aria-pressed", "false");
      } else {
        path.setAttribute("aria-hidden", "true");
      }
      baseGroup.appendChild(path);
      paths.set(dept.id, path);
      bindElement(path, dept, false);

      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(dept.capitalPoint[0]));
      dot.setAttribute("cy", String(dept.capitalPoint[1]));
      dot.setAttribute("r", "3.2");
      dot.setAttribute("class", `capital-dot${opts.capitals ? "" : " is-hidden"}`);
      dot.dataset.id = dept.id;
      dotsGroup.appendChild(dot);
      dots.set(dept.id, dot);
    }

    const districtPath = document.createElementNS(NS, "path");
    districtPath.setAttribute("d", data.district.path);
    const districtClasses = ["district"];
    if (opts.interactive) districtClasses.push("is-interactive");
    if (opts.onHover) districtClasses.push("is-hoverable");
    districtPath.setAttribute("class", districtClasses.join(" "));
    districtPath.dataset.id = "asuncion";
    if (opts.interactive) {
      districtPath.setAttribute("tabindex", "0");
      districtPath.setAttribute("focusable", "true");
      districtPath.setAttribute("role", "button");
      districtPath.setAttribute("aria-label", "Asunción, distrito capital");
      districtPath.setAttribute("aria-pressed", "false");
    } else {
      districtPath.setAttribute("aria-hidden", "true");
    }
    baseGroup.appendChild(districtPath);
    bindElement(districtPath, districtItem, true);

    const districtDot = document.createElementNS(NS, "circle");
    districtDot.setAttribute("cx", String(data.district.capitalPoint[0]));
    districtDot.setAttribute("cy", String(data.district.capitalPoint[1]));
    districtDot.setAttribute("r", "3.2");
    districtDot.setAttribute("class", `capital-dot capital-dot--district${opts.capitals ? "" : " is-hidden"}`);
    districtDot.dataset.id = "asuncion";
    dotsGroup.appendChild(districtDot);
    dots.set("asuncion", districtDot);

    for (const dept of departments) {
      if (opts.labels && dept.leader && dept.anchor) {
        const leader = document.createElementNS(NS, "line");
        leader.setAttribute("x1", String(dept.anchor[0]));
        leader.setAttribute("y1", String(dept.anchor[1]));
        leader.setAttribute("x2", String(dept.label[0]));
        leader.setAttribute("y2", String(dept.label[1] - 3));
        leader.setAttribute("class", "leader-line");
        labelsGroup.appendChild(leader);
      }

      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", String(dept.label[0]));
      label.setAttribute("y", String(dept.label[1]));
      const classes = ["dept-label"];
      if (TINY_LABELS.has(dept.id)) classes.push("dept-label--tiny");
      else if (SMALL_LABELS.has(dept.id)) classes.push("dept-label--small");
      if (!opts.labels) classes.push("is-hidden");
      label.setAttribute("class", classes.join(" "));
      label.textContent = dept.name;
      labelsGroup.appendChild(label);
      labels.set(dept.id, label);
    }

    let districtLabel = null;
    let leader = null;
    if (opts.districtLabel) {
      leader = document.createElementNS(NS, "line");
      leader.setAttribute("x1", String(data.district.anchor[0]));
      leader.setAttribute("y1", String(data.district.anchor[1]));
      leader.setAttribute("x2", String(data.district.label[0]));
      leader.setAttribute("y2", String(data.district.label[1] - 4));
      leader.setAttribute("class", "leader-line");
      labelsGroup.appendChild(leader);

      districtLabel = document.createElementNS(NS, "text");
      districtLabel.setAttribute("x", String(data.district.label[0]));
      districtLabel.setAttribute("y", String(data.district.label[1]));
      districtLabel.setAttribute("class", "dept-label dept-label--district");
      districtLabel.textContent = "Asunción";
      labelsGroup.appendChild(districtLabel);
    }

    return { svg, paths, labels, dots, district: districtPath, districtLabel, leader };
  }

  function applyLabelScale(svg) {
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const scale = Math.max(0.1, rect.width / data.width);
    const base = Math.max(10.5, Math.min(13.5, 9 + rect.width * 0.004));
    svg.style.setProperty("--label-size", `${(base / scale).toFixed(2)}px`);
    svg.style.setProperty("--label-size-small", `${((base * 0.84) / scale).toFixed(2)}px`);
    svg.style.setProperty("--label-size-tiny", `${((base * 0.76) / scale).toFixed(2)}px`);
    svg.style.setProperty("--label-size-district", `${((base * 0.84) / scale).toFixed(2)}px`);
    svg.style.setProperty("--label-halo", `${(3 / scale).toFixed(2)}px`);
    svg.style.setProperty("--capital-dot-radius", `${(3.5 / scale).toFixed(2)}px`);
  }

  function observeMap(svg) {
    if (state.labelObserver) state.labelObserver.observe(svg);
    applyLabelScale(svg);
  }

  function releaseMap(map) {
    if (map && state.labelObserver) state.labelObserver.unobserve(map.svg);
  }

  function refreshMapScales() {
    [state.homeMap, state.studyMap, state.gameMap, state.resultsMap].forEach((map) => {
      if (map) applyLabelScale(map.svg);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Estudio                                                             */
  /* ------------------------------------------------------------------ */

  function buildStudyList() {
    for (const dept of departments) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "study-row";
      button.dataset.id = dept.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `${dept.name}, capital ${dept.capital}`);

      const name = document.createElement("span");
      name.className = "study-row__name";
      name.textContent = dept.name;

      const capital = document.createElement("span");
      capital.className = "study-row__capital";
      capital.textContent = dept.capital;

      const number = document.createElement("span");
      number.className = "study-row__number";
      number.textContent = String(dept.number);
      number.setAttribute("aria-hidden", "true");

      button.append(number, name, capital);
      button.setAttribute("aria-label", `Número ${dept.number}, ${dept.name}, capital ${dept.capital}`);
      button.addEventListener("click", () => selectStudy(dept.id));
      state.studyRows.set(dept.id, button);

      const target =
        dept.region === "occidental" ? refs.studyListOccidental : refs.studyListOriental;
      target.appendChild(button);
    }
  }

  function renderStudyDetail(id) {
    if (!id) {
      refs.studyDetail.innerHTML = [
        '<p class="eyebrow">Mapa de estudio</p>',
        '<h2>Elegí un departamento</h2>',
        '<p class="detail-card__note">Tocá una región del mapa o una fila de la lista para ver su número, su capital, su región y su superficie.</p>',
      ].join("");
      return;
    }

    if (id === "asuncion") {
      refs.studyDetail.innerHTML = [
        '<div class="detail-card__top">',
        '<p class="eyebrow">Distrito Capital</p>',
        "</div>",
        "<h2>Asunción</h2>",
        '<p class="detail-card__capital-label">Capital</p>',
        '<p class="detail-card__capital">Capital del país</p>',
        '<p class="detail-card__note">No es un departamento: es un municipio autónomo y sede de los poderes del Estado. Por eso no tiene número departamental.</p>',
        "<dl>",
        `<div><dt>Región</dt><dd>${regionLabel(districtItem.region)}</dd></div>`,
        `<div><dt>Superficie</dt><dd>${formatArea(districtItem.areaKm2)}</dd></div>`,
        "</dl>",
      ].join("");
      return;
    }

    const dept = deptById.get(id);
    if (!dept) return;

    refs.studyDetail.innerHTML = [
      '<div class="detail-card__top">',
      '<p class="eyebrow">Departamento</p>',
      `<span class="detail-card__number">N.º ${dept.number}</span>`,
      "</div>",
      `<h2>${dept.name}</h2>`,
      '<p class="detail-card__capital-label">Capital</p>',
      `<p class="detail-card__capital">${dept.capital}</p>`,
      "<dl>",
      `<div><dt>Región</dt><dd>${regionLabel(dept.region)}</dd></div>`,
      `<div><dt>Superficie</dt><dd>${formatArea(dept.areaKm2)}</dd></div>`,
      "</dl>",
    ].join("");
  }

  function selectStudy(id) {
    if (!state.studyMap || (id !== "asuncion" && !deptById.has(id))) return;
    state.studySelected = id;

    state.studyMap.paths.forEach((path, key) => {
      const active = key === id;
      path.classList.toggle("is-selected", active);
      path.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const districtActive = id === "asuncion";
    state.studyMap.district.classList.toggle("is-selected", districtActive);
    state.studyMap.district.setAttribute("aria-pressed", districtActive ? "true" : "false");

    state.studyRows.forEach((row, key) => {
      const active = key === id;
      row.classList.toggle("is-active", active);
      row.setAttribute("aria-pressed", active ? "true" : "false");
    });

    renderStudyDetail(id);
  }

  function setCapitalsVisible(visible) {
    state.showCapitals = visible;
    if (state.studyMap) {
      state.studyMap.dots.forEach((dot) => {
        dot.classList.toggle("is-hidden", !visible);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Juego                                                               */
  /* ------------------------------------------------------------------ */

  function buildGameMap() {
    const map = createMap({
      interactive: state.mode !== "eleccion",
      labels: false,
      capitals: false,
      districtLabel: false,
      onSelect: handleMapAnswer,
      onDistrictSelect: function () {
        if (state.session && !state.locked) {
          showToast("Asunción es la capital del país, no un departamento.");
        }
      },
      role: "group",
      ariaLabel: "Mapa de Paraguay. Elegí un departamento.",
    });
    refs.gameMapEl.replaceChildren(map.svg);
    state.gameMap = map;
    observeMap(map.svg);
  }

  function resetGameUI() {
    refs.gameModeLabel.textContent = MODE_LABELS[state.mode] || "Juego";
    refs.gameTimer.textContent = "00:00";
    refs.gameProgressLabel.textContent = "0 / 17";
    refs.gameProgressBar.style.width = "0%";
    refs.gameErrors.textContent = "0";
    refs.gameMastered.textContent = "0";
    refs.gameErrorsLabel.textContent = "errores";
    refs.gameMasteredLabel.textContent = "dominados";
    refs.gamePromptKind.textContent = PROMPTS[state.mode] ? PROMPTS[state.mode].kind : "Encuentra el departamento";
    refs.gamePrompt.textContent = "—";
    refs.gameHint.textContent = PROMPTS[state.mode] ? PROMPTS[state.mode].hint : "";
    refs.choiceOptions.hidden = true;
    clearNode(refs.choiceOptions);
    hideFeedback();
  }

  function startGame(mode) {
    if (!MODES[mode]) return;
    stopGame();
    state.mode = mode;
    state.session = new Session(departments, mode);
    state.finishing = false;
    state.locked = true;
    state.elapsed = 0;

    refs.gameLayout.classList.toggle("is-choice", mode === "eleccion");
    buildGameMap();
    resetGameUI();
    showScreen("game");

    const first = state.session.start();
    renderQuestion(first);
    startTimer();
    window.requestAnimationFrame(() => {
      refs.gamePrompt.focus({ preventScroll: true });
    });
  }

  function renderQuestion(current) {
    if (!current) {
      if (state.session && state.session.finished) finishGame();
      return;
    }

    const target = current.department;
    const prompt = PROMPTS[state.mode];
    state.locked = false;

    clearGamePathStates();
    hideFeedback();
    refs.choiceOptions.hidden = true;
    clearNode(refs.choiceOptions);

    refs.gamePromptKind.textContent = prompt.kind;
    refs.gamePrompt.textContent = state.mode === "capitales" ? target.capital : target.name;
    refs.gameHint.textContent = prompt.hint;
    refs.gameMapNote.textContent =
      state.mode === "eleccion" ? "Departamento iluminado" : "Hacé clic en el mapa";
    refs.gameMapHelp.innerHTML =
      state.mode === "eleccion"
        ? 'Elegí la capital en las opciones. También podés usar <span class="kbd">1</span> a <span class="kbd">4</span>.'
        : 'Hacé clic en el departamento correcto. También podés usar <span class="kbd">Tab</span> y <span class="kbd">Enter</span>.';

    if (state.mode === "eleccion") {
      state.gameMap.paths.forEach((path, id) => {
        path.classList.toggle("is-dimmed", id !== target.id);
      });
      state.gameMap.district.classList.add("is-dimmed");
      const targetPath = state.gameMap.paths.get(target.id);
      if (targetPath) targetPath.classList.add("is-target");
      renderChoices(current.options);
      refs.choiceOptions.hidden = false;
      window.requestAnimationFrame(() => {
        const firstButton = refs.choiceOptions.querySelector("button");
        if (firstButton) firstButton.focus({ preventScroll: true });
      });
    }

    updateGameStats();
  }

  function renderChoices(options) {
    (options || []).forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.dataset.id = option.id;

      const key = document.createElement("span");
      key.className = "choice-button__key";
      key.setAttribute("aria-hidden", "true");
      key.textContent = String(index + 1);

      const label = document.createElement("span");
      label.textContent = option.label;

      button.append(key, label);
      button.addEventListener("click", () => handleChoice(option.id));
      refs.choiceOptions.appendChild(button);
    });
  }

  function clearGamePathStates() {
    if (!state.gameMap) return;
    state.gameMap.paths.forEach((path) => {
      path.classList.remove("is-correct", "is-wrong", "is-reveal", "is-target", "is-dimmed", "is-selected");
    });
    state.gameMap.district.classList.remove("is-correct", "is-wrong", "is-reveal", "is-target", "is-dimmed", "is-selected");
    state.gameMap.labels.forEach((label) => label.classList.add("is-hidden"));
  }

  function revealGameLabel(id) {
    if (!state.gameMap) return;
    const label = state.gameMap.labels.get(id);
    if (label) label.classList.remove("is-hidden");
  }

  function paintPath(id, className) {
    if (!state.gameMap) return;
    const path = state.gameMap.paths.get(id);
    if (path) path.classList.add(className);
  }

  function updateGameStats() {
    if (!state.session) return;
    const stats = state.session.stats();
    refs.gameProgressLabel.textContent = `${stats.mastered} / ${stats.total}`;
    refs.gameProgressBar.style.width = `${(stats.mastered / stats.total) * 100}%`;
    refs.gameErrors.textContent = String(stats.errors);
    refs.gameMastered.textContent = String(stats.mastered);
    refs.gameErrorsLabel.textContent = stats.errors === 1 ? "error" : "errores";
    refs.gameMasteredLabel.textContent = stats.mastered === 1 ? "dominado" : "dominados";
  }

  function showFeedback(kind, html) {
    refs.gameFeedback.className = `feedback is-${kind}`;
    refs.gameFeedback.innerHTML = html;
    refs.gameFeedback.hidden = false;
  }

  function hideFeedback() {
    refs.gameFeedback.hidden = true;
    refs.gameFeedback.className = "feedback";
    refs.gameFeedback.innerHTML = "";
  }

  function answerFeedback(expected, correct) {
    const number = expected.number ? ` (N.º ${expected.number})` : "";
    if (correct) {
      return `¡Correcto! <strong>${expected.name}</strong>${number}. Su capital es <strong>${expected.capital}</strong>.`;
    }
    return `Era <strong>${expected.name}</strong>${number}. Su capital es <strong>${expected.capital}</strong>. La volverás a ver.`;
  }

  function handleMapAnswer(id) {
    if (!state.session || state.locked) return;
    if (id === "asuncion") {
      showToast("Asunción es la capital del país, no un departamento.");
      return;
    }

    const result = state.session.answer(id);
    if (!result) return;
    state.locked = true;

    if (result.correct) {
      paintPath(result.expected.id, "is-correct");
      playCorrect();
    } else {
      paintPath(id, "is-wrong");
      paintPath(result.expected.id, "is-reveal");
      revealGameLabel(result.expected.id);
      playWrong();
    }

    showFeedback(result.correct ? "correct" : "wrong", answerFeedback(result.expected, result.correct));
    updateGameStats();

    if (result.finished) scheduleFinish(700);
    else scheduleAdvance(result.correct ? 650 : 1600);
  }

  function handleChoice(id) {
    if (!state.session || state.locked) return;

    const result = state.session.answer(id);
    if (!result) return;
    state.locked = true;

    state.gameMap.paths.forEach((path) => path.classList.remove("is-target", "is-dimmed"));
    state.gameMap.district.classList.remove("is-dimmed");

    const target = result.expected;
    const buttons = refs.choiceOptions.querySelectorAll(".choice-button");
    buttons.forEach((button) => {
      if (button.dataset.id === target.id) button.classList.add("is-correct");
      if (!result.correct && button.dataset.id === id) button.classList.add("is-wrong");
      if (!result.correct && button.dataset.id !== target.id && button.dataset.id !== id) {
        button.classList.add("is-dimmed");
      }
    });

    if (result.correct) {
      paintPath(target.id, "is-correct");
      playCorrect();
    } else {
      paintPath(target.id, "is-reveal");
      revealGameLabel(target.id);
      playWrong();
    }

    showFeedback(result.correct ? "correct" : "wrong", answerFeedback(target, result.correct));
    updateGameStats();

    if (result.finished) scheduleFinish(750);
    else scheduleAdvance(result.correct ? 750 : 1750);
  }

  function scheduleAdvance(delay) {
    window.clearTimeout(state.advanceTimer);
    state.advanceTimer = window.setTimeout(() => {
      state.advanceTimer = null;
      if (!state.session) return;
      if (state.session.finished) {
        finishGame();
        return;
      }
      const next = state.session.next();
      if (!next) {
        finishGame();
        return;
      }
      renderQuestion(next);
    }, delay);
  }

  function scheduleFinish(delay) {
    window.clearTimeout(state.finishTimer);
    state.finishTimer = window.setTimeout(() => {
      state.finishTimer = null;
      finishGame();
    }, delay);
  }

  function startTimer() {
    stopTimer();
    state.startedAt = performance.now();
    updateTimer(0);
    state.timerId = window.setInterval(() => {
      if (!state.session) return;
      updateTimer(performance.now() - state.startedAt);
    }, 250);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function updateTimer(ms) {
    refs.gameTimer.textContent = formatTime(ms);
    refs.gameTimer.setAttribute("aria-label", `Tiempo transcurrido: ${formatTime(ms)}`);
  }

  function finishGame() {
    if (!state.session || state.finishing) return;
    state.finishing = true;
    state.locked = true;
    state.elapsed = performance.now() - state.startedAt;
    stopTimer();
    updateTimer(state.elapsed);
    playFinish();

    state.finishTimer = window.setTimeout(() => {
      state.finishTimer = null;
      if (!state.session) return;
      renderResults();
      showScreen("results");
      window.requestAnimationFrame(() => {
        refs.resultsTitle.focus({ preventScroll: true });
      });
    }, 700);
  }

  function stopGame() {
    stopTimer();
    window.clearTimeout(state.advanceTimer);
    window.clearTimeout(state.finishTimer);
    state.advanceTimer = null;
    state.finishTimer = null;
    releaseMap(state.gameMap);
    state.session = null;
    state.mode = null;
    state.locked = true;
    state.finishing = false;
    state.elapsed = 0;
    state.gameMap = null;
    hideTooltip();
  }

  /* ------------------------------------------------------------------ */
  /* Resultados y récords                                                */
  /* ------------------------------------------------------------------ */

  function getRecords() {
    const value = readJSON(STORAGE.records, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function updateBestLabels() {
    const records = getRecords();
    document.querySelectorAll("[data-best]").forEach((element) => {
      const record = records[element.dataset.best];
      if (record && Number.isFinite(record.ms)) {
        element.textContent = `Récord · ${formatTime(record.ms)}`;
      } else {
        element.textContent = "Aún sin récord";
      }
    });
  }

  function maybeSaveRecord(mode, stats) {
    const records = getRecords();
    const previous =
      records[mode] && Number.isFinite(records[mode].ms) ? records[mode] : null;

    if (stats.errors !== 0) {
      return { saved: false, previous, best: previous };
    }

    if (!previous || state.elapsed < previous.ms) {
      const next = {
        ms: Math.round(state.elapsed),
        accuracy: stats.accuracy,
        date: new Date().toISOString(),
      };
      records[mode] = next;
      writeJSON(STORAGE.records, records);
      updateBestLabels();
      return { saved: true, previous, best: next };
    }

    return { saved: false, previous, best: previous };
  }

  function renderResults() {
    if (!state.session || !state.mode) return;
    const stats = state.session.stats();
    const mode = state.mode;
    const modeInfo = MODES[mode];

    refs.resultsSubtitle.textContent = `Completaste los 17 departamentos en el modo «${modeInfo.headline}».`;
    refs.resultTime.textContent = formatTime(state.elapsed);
    refs.resultFirstTry.textContent = `${stats.firstTry}/${stats.total}`;
    refs.resultErrors.textContent = String(stats.errors);
    refs.resultAccuracy.textContent = `${stats.accuracy}%`;

    clearNode(refs.resultMissed);
    stats.missed.forEach((dept) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.className = "missed-list__number";
      number.textContent = String(dept.number);
      number.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = dept.name;
      const capital = document.createElement("span");
      capital.textContent = dept.capital;
      item.append(number, name, capital);
      item.setAttribute("aria-label", `Número ${dept.number}, ${dept.name}, ${dept.capital}`);
      refs.resultMissed.appendChild(item);
    });
    refs.resultMissedWrap.hidden = stats.missed.length === 0;

    const record = maybeSaveRecord(mode, stats);
    let badgeText = "";

    if (stats.errors > 0) {
      if (record.best) {
        badgeText = `Récord del modo: ${formatTime(record.best.ms)} sin errores. Esta partida tuvo ${stats.errors} ${
          stats.errors === 1 ? "error" : "errores"
        }.`;
      } else {
        badgeText = `Completado con ${stats.errors} ${
          stats.errors === 1 ? "error" : "errores"
        }. Si terminás sin errores, guardás tu primer récord.`;
      }
    } else if (record.saved) {
      badgeText = record.previous
        ? `¡Nuevo récord! Antes: ${formatTime(record.previous.ms)} · Ahora: ${formatTime(record.best.ms)}.`
        : `¡Primer récord guardado! ${formatTime(record.best.ms)} sin errores.`;
    } else if (record.best) {
      badgeText = `Récord del modo: ${formatTime(record.best.ms)} sin errores.`;
    }

    refs.resultRecord.textContent = badgeText;
    refs.resultRecord.hidden = !badgeText;
    refs.resultRecord.classList.toggle("is-record", Boolean(record.saved && stats.errors === 0));

    const map = createMap({
      labels: false,
      capitals: false,
      districtLabel: false,
      role: "img",
      ariaLabel: "Mapa de Paraguay completado",
    });
    map.paths.forEach((path) => path.classList.add("is-mastered"));
    releaseMap(state.resultsMap);
    refs.resultsMapEl.replaceChildren(map.svg);
    state.resultsMap = map;
    observeMap(map.svg);
  }

  /* ------------------------------------------------------------------ */
  /* Pantallas y rutas                                                   */
  /* ------------------------------------------------------------------ */

  function showScreen(name) {
    state.screen = name;
    document.body.dataset.screen = name;

    refs.screens.forEach((screen) => {
      screen.hidden = screen.dataset.screen !== name;
    });

    refs.navLinks.forEach((link) => {
      const active =
        (name === "home" && link.dataset.nav === "home") ||
        (name === "study" && link.dataset.nav === "study");
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    document.title = TITLES[name] || TITLES.home;
    hideTooltip();
    if (refs.toast) {
      refs.toast.hidden = true;
      window.clearTimeout(state.toastTimer);
    }
    window.scrollTo(0, 0);
    window.requestAnimationFrame(refreshMapScales);
  }

  function requestGame(mode) {
    if (!MODES[mode]) return;
    const hash = `#/jugar/${mode}`;
    if (window.location.hash === hash) startGame(mode);
    else window.location.hash = hash;
  }

  function ensureStudySelection() {
    if (!state.studyMap) return;
    if (state.studySelected) {
      const valid = state.studySelected === "asuncion" || deptById.has(state.studySelected);
      if (valid) {
        selectStudy(state.studySelected);
        return;
      }
    }
    renderStudyDetail(null);
  }

  function handleRoute() {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const parts = raw.split("/");
    const section = parts[0];
    const argument = parts[1];

    if (section === "estudiar") {
      stopGame();
      showScreen("study");
      ensureStudySelection();
      return;
    }

    if (section === "jugar" && MODES[argument]) {
      startGame(argument);
      return;
    }

    stopGame();
    showScreen("home");
    setHomeCaption(null);
    updateBestLabels();
  }

  /* ------------------------------------------------------------------ */
  /* Inicialización                                                      */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-start-mode]");
      if (!trigger) return;
      event.preventDefault();
      requestGame(trigger.dataset.startMode);
    });

    if (refs.helpButton && refs.helpDialog) {
      refs.helpButton.addEventListener("click", () => {
        if (typeof refs.helpDialog.showModal === "function") refs.helpDialog.showModal();
        else refs.helpDialog.setAttribute("open", "");
      });
      refs.helpDialog.querySelectorAll("[data-close-help]").forEach((button) => {
        button.addEventListener("click", () => refs.helpDialog.close());
      });
      refs.helpDialog.addEventListener("click", (event) => {
        if (event.target === refs.helpDialog) refs.helpDialog.close();
      });
    }

    refs.soundToggle.addEventListener("click", () => {
      state.soundOn = !state.soundOn;
      writeJSON(STORAGE.sound, state.soundOn);
      updateSoundUI();
      if (state.soundOn) playToggle();
    });

    refs.showCapitals.addEventListener("change", () => {
      setCapitalsVisible(refs.showCapitals.checked);
      writeJSON(STORAGE.capitals, state.showCapitals);
    });

    refs.resultReplay.addEventListener("click", () => {
      const mode = state.mode;
      if (mode) startGame(mode);
    });

    document.addEventListener("keydown", (event) => {
      if (state.screen !== "game" || state.mode !== "eleccion" || state.locked) return;
      if (!/^[1-4]$/.test(event.key)) return;
      const button = refs.choiceOptions.children[Number(event.key) - 1];
      if (button) {
        event.preventDefault();
        button.click();
      }
    });

    window.addEventListener("hashchange", handleRoute);
    window.addEventListener("resize", () => {
      hideTooltip();
      refreshMapScales();
    });
    window.addEventListener("scroll", hideTooltip, { passive: true });
    document.addEventListener("visibilitychange", hideTooltip);
  }

  function init() {
    refs.screens = Array.from(document.querySelectorAll(".screen"));
    refs.navLinks = Array.from(document.querySelectorAll(".site-nav a"));
    refs.homeMapEl = $("#home-map");
    refs.studyMapEl = $("#study-map");
    refs.gameLayout = $(".game-layout");
    refs.gameMapEl = $("#game-map");
    refs.resultsMapEl = $("#results-map");
    refs.homeCaption = $("#home-caption");
    refs.studyDetail = $("#study-detail");
    refs.studyListOccidental = $("#study-list-occidental");
    refs.studyListOriental = $("#study-list-oriental");
    refs.showCapitals = $("#show-capitals");
    refs.soundToggle = $("#sound-toggle");
    refs.helpButton = $("#help-button");
    refs.helpDialog = $("#help-dialog");
    refs.gameModeLabel = $("#game-mode-label");
    refs.gameTimer = $("#game-timer");
    refs.gameProgressLabel = $("#game-progress-label");
    refs.gameProgressBar = $("#game-progress-bar");
    refs.gamePromptKind = $("#game-prompt-kind");
    refs.gamePrompt = $("#game-prompt");
    refs.gameHint = $("#game-hint");
    refs.gameErrors = $("#game-errors");
    refs.gameMastered = $("#game-mastered");
    refs.gameErrorsLabel = $("#game-errors-label");
    refs.gameMasteredLabel = $("#game-mastered-label");
    refs.gameFeedback = $("#game-feedback");
    refs.choiceOptions = $("#choice-options");
    refs.gameMapNote = $("#game-map-note");
    refs.gameMapHelp = $("#game-map-help");
    refs.resultsTitle = $("#results-title");
    refs.resultsSubtitle = $("#results-subtitle");
    refs.resultTime = $("#result-time");
    refs.resultFirstTry = $("#result-firsttry");
    refs.resultErrors = $("#result-errors");
    refs.resultAccuracy = $("#result-accuracy");
    refs.resultRecord = $("#result-record");
    refs.resultMissedWrap = $("#result-missed-wrap");
    refs.resultMissed = $("#result-missed");
    refs.resultReplay = $("#result-replay");
    refs.toast = $("#toast");
    refs.tooltip = $("#map-tooltip");

    refs.gamePrompt.setAttribute("tabindex", "-1");
    refs.resultsTitle.setAttribute("tabindex", "-1");

    state.soundOn = readJSON(STORAGE.sound, true) !== false;
    state.showCapitals = readJSON(STORAGE.capitals, true) !== false;
    refs.showCapitals.checked = state.showCapitals;

    if (typeof window.ResizeObserver === "function") {
      state.labelObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => applyLabelScale(entry.target));
      });
    }

    state.homeMap = createMap({
      labels: false,
      capitals: false,
      districtLabel: true,
      onHover: handleHomeHover,
      onLeave: handleHomeLeave,
      role: "img",
      ariaLabel: "Mapa de Paraguay con sus 17 departamentos",
    });
    refs.homeMapEl.replaceChildren(state.homeMap.svg);
    observeMap(state.homeMap.svg);

    state.studyMap = createMap({
      interactive: true,
      labels: true,
      capitals: state.showCapitals,
      districtLabel: true,
      onHover: showTooltip,
      onLeave: hideTooltip,
      onSelect: selectStudy,
      onDistrictSelect: () => selectStudy("asuncion"),
      role: "group",
      ariaLabel: "Mapa interactivo de Paraguay. 17 departamentos y Asunción.",
    });
    refs.studyMapEl.replaceChildren(state.studyMap.svg);
    observeMap(state.studyMap.svg);

    buildStudyList();
    updateBestLabels();
    updateSoundUI();
    bindEvents();
    setHomeCaption(null);
    handleRoute();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
