#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera map-data.js a partir de los límites reales de Paraguay.

Fuente: geoBoundaries gbOpen PRY ADM1 (simplified), CC BY 4.0.
Proyección: Albers Equal Area, escala única (sin deformar el mapa).

Uso:
    python tools/build_map.py
    python tools/build_map.py --check
    python tools/build_map.py --refresh
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import unicodedata
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SOURCE_FILE = DATA_DIR / "geoBoundaries-PRY-ADM1_simplified.geojson"
OUTPUT_FILE = ROOT.parent / "map-data.js"
SOURCE_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/"
    "releaseData/gbOpen/PRY/ADM1/geoBoundaries-PRY-ADM1_simplified.geojson"
)

MAP_WIDTH = 1000.0
PADDING = 26.0

# Albers Equal Area para Paraguay
LON0 = -58.45
LAT0 = -23.44
PHI1 = math.radians(-20.0)
PHI2 = math.radians(-28.0)

ASUNCION_KEY = "ASUNCION"

# Metadatos por departamento. La clave es el nombre normalizado de la fuente.
DEPARTMENTS = {
    "ALTO PARAGUAY": {
        "id": "alto-paraguay",
        "name": "Alto Paraguay",
        "capital": "Fuerte Olimpo",
        "region": "occidental",
        "areaKm2": 82349,
        "capitalLat": -21.0417,
        "capitalLon": -57.8731,
    },
    "ALTO PARANA": {
        "id": "alto-parana",
        "name": "Alto Paraná",
        "capital": "Ciudad del Este",
        "region": "oriental",
        "areaKm2": 14895,
        "capitalLat": -25.5097,
        "capitalLon": -54.6111,
    },
    "AMAMBAY": {
        "id": "amambay",
        "name": "Amambay",
        "capital": "Pedro Juan Caballero",
        "region": "oriental",
        "areaKm2": 12933,
        "capitalLat": -22.5472,
        "capitalLon": -55.7319,
    },
    "BOQUERON": {
        "id": "boqueron",
        "name": "Boquerón",
        "capital": "Filadelfia",
        "region": "occidental",
        "areaKm2": 91669,
        "capitalLat": -22.35,
        "capitalLon": -60.0333,
    },
    "CAAGUAZU": {
        "id": "caaguazu",
        "name": "Caaguazú",
        "capital": "Coronel Oviedo",
        "region": "oriental",
        "areaKm2": 11474,
        "capitalLat": -25.4447,
        "capitalLon": -56.4403,
    },
    "CAAZAPA": {
        "id": "caazapa",
        "name": "Caazapá",
        "capital": "Caazapá",
        "region": "oriental",
        "areaKm2": 9496,
        "capitalLat": -26.1958,
        "capitalLon": -56.3681,
    },
    "CANINDEYU": {
        "id": "canindeyu",
        "name": "Canindeyú",
        "capital": "Salto del Guairá",
        "region": "oriental",
        "areaKm2": 14667,
        "capitalLat": -24.0628,
        "capitalLon": -54.3069,
    },
    "CENTRAL": {
        "id": "central",
        "name": "Central",
        "capital": "Areguá",
        "region": "oriental",
        "areaKm2": 2465,
        "capitalLat": -25.3125,
        "capitalLon": -57.3847,
    },
    "CONCEPCION": {
        "id": "concepcion",
        "name": "Concepción",
        "capital": "Concepción",
        "region": "oriental",
        "areaKm2": 18051,
        "capitalLat": -23.4064,
        "capitalLon": -57.4344,
    },
    "CORDILLERA": {
        "id": "cordillera",
        "name": "Cordillera",
        "capital": "Caacupé",
        "region": "oriental",
        "areaKm2": 4948,
        "capitalLat": -25.3861,
        "capitalLon": -57.1408,
    },
    "GUAIRA": {
        "id": "guaira",
        "name": "Guairá",
        "capital": "Villarrica",
        "region": "oriental",
        "areaKm2": 3846,
        "capitalLat": -25.75,
        "capitalLon": -56.4333,
    },
    "ITAPUA": {
        "id": "itapua",
        "name": "Itapúa",
        "capital": "Encarnación",
        "region": "oriental",
        "areaKm2": 16525,
        "capitalLat": -27.3306,
        "capitalLon": -55.8667,
    },
    "MISIONES": {
        "id": "misiones",
        "name": "Misiones",
        "capital": "San Juan Bautista",
        "region": "oriental",
        "areaKm2": 9556,
        "capitalLat": -26.6694,
        "capitalLon": -57.145,
    },
    "NEEMBUCU": {
        "id": "neembucu",
        "name": "Ñeembucú",
        "capital": "Pilar",
        "region": "oriental",
        "areaKm2": 12147,
        "capitalLat": -26.8583,
        "capitalLon": -58.3056,
    },
    "PARAGUARI": {
        "id": "paraguari",
        "name": "Paraguarí",
        "capital": "Paraguarí",
        "region": "oriental",
        "areaKm2": 8705,
        "capitalLat": -25.6333,
        "capitalLon": -57.15,
    },
    "PRESIDENTE HAYES": {
        "id": "presidente-hayes",
        "name": "Presidente Hayes",
        "capital": "Villa Hayes",
        "region": "occidental",
        "areaKm2": 72907,
        "capitalLat": -25.1,
        "capitalLon": -57.5167,
    },
    "SAN PEDRO": {
        "id": "san-pedro",
        "name": "San Pedro",
        "capital": "San Pedro del Ycuamandiyú",
        "region": "oriental",
        "areaKm2": 20002,
        "capitalLat": -24.0833,
        "capitalLon": -57.0833,
    },
}

ASUNCION = {
    "name": "Asunción",
    "note": "Capital del país · Distrito Capital (no es un departamento)",
    "capitalLat": -25.2637,
    "capitalLon": -57.5759,
}

# Numeración departamental nacional (1–17), la usada en la tabla de
# departamentos y en el clasificador del Congreso (Boquerón = XVI).
# Ojo: no coincide con los códigos ISO 3166-2 de Boquerón (PY-19) y
# Alto Paraguay (PY-16), que son otra codificación.
NATIONAL_NUMBERS = {
    "concepcion": 1,
    "san-pedro": 2,
    "cordillera": 3,
    "guaira": 4,
    "caaguazu": 5,
    "caazapa": 6,
    "itapua": 7,
    "misiones": 8,
    "paraguari": 9,
    "alto-parana": 10,
    "central": 11,
    "neembucu": 12,
    "amambay": 13,
    "canindeyu": 14,
    "presidente-hayes": 15,
    "boqueron": 16,
    "alto-paraguay": 17,
}

# Ajustes manuales de etiquetas (en coordenadas del SVG) para evitar
# solapamientos. Se completan después de revisar las capturas.
LABEL_OFFSETS = {
    "central": (-50.0, 40.0),
    "cordillera": (0.0, -4.0),
    "guaira": (10.0, 0.0),
    "caazapa": (0.0, 6.0),
    "neembucu": (18.0, 14.0),
    "paraguari": (-4.0, 4.0),
}

# Asunción: etiqueta fuera del polígono con una línea guía.
ASUNCION_LABEL_OFFSET = (-78.0, 18.0)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def normalize_name(value: str) -> str:
    """ASUNCIÓN -> ASUNCION, Ñeembucú -> NEEMBUCU."""
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(without_marks.upper().split())


def fetch_source(force: bool = False) -> None:
    if SOURCE_FILE.exists() and not force:
        print(f"Usando fuente cacheada: {SOURCE_FILE.relative_to(ROOT.parent)}")
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Descargando límites desde geoBoundaries…")
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "paraguay-map-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
    SOURCE_FILE.write_bytes(payload)
    print(f"Guardado: {SOURCE_FILE.relative_to(ROOT.parent)} ({len(payload):,} bytes)")


# ---------------------------------------------------------------------------
# Proyección Albers Equal Area
# ---------------------------------------------------------------------------

N = (math.sin(PHI1) + math.sin(PHI2)) / 2.0
C = math.cos(PHI1) ** 2 + 2.0 * N * math.sin(PHI1)
RHO0 = math.sqrt(C - 2.0 * N * math.sin(math.radians(LAT0))) / N


def project_raw(lon: float, lat: float) -> tuple[float, float]:
    """Devuelve coordenadas Albers sin escalar (unidades radianes)."""
    rho = math.sqrt(C - 2.0 * N * math.sin(math.radians(lat))) / N
    theta = N * (math.radians(lon) - math.radians(LON0))
    x = rho * math.sin(theta)
    y = RHO0 - rho * math.cos(theta)
    return x, y


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------


def iter_rings(feature: dict):
    geometry = feature["geometry"]
    if geometry["type"] == "Polygon":
        for ring in geometry["coordinates"]:
            yield ring
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            for ring in polygon:
                yield ring
    else:
        raise ValueError(f"Geometría no soportada: {geometry['type']}")


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    count = len(ring)
    j = count - 1
    for i in range(count):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_feature(x: float, y: float, feature: dict) -> bool:
    # Los polígonos de esta fuente no tienen huecos; basta con el anillo exterior.
    return any(point_in_ring(x, y, ring) for ring in iter_rings(feature))


def segment_distance_sq(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx = bx - ax
    dy = by - ay
    if dx == 0.0 and dy == 0.0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx = ax + t * dx
    qy = ay + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2


def distance_to_ring(x: float, y: float, ring: list[list[float]]) -> float:
    best = math.inf
    count = len(ring)
    for i in range(count):
        ax, ay = ring[i][0], ring[i][1]
        bx, by = ring[(i + 1) % count][0], ring[(i + 1) % count][1]
        d = segment_distance_sq(x, y, ax, ay, bx, by)
        if d < best:
            best = d
    return math.sqrt(best)


def label_anchor(ring: list[list[float]], grid: int = 20) -> tuple[float, float]:
    """Aproxima polylabel: punto interior lo más lejos posible del borde.

    Se evalúa una cuadrícula dentro del bbox y se elige el punto interior con
    mayor distancia al contorno. Es rápido y suficiente para etiquetas.
    """
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    width = maxx - minx
    height = maxy - miny

    best_point = ((minx + maxx) / 2.0, (miny + maxy) / 2.0)
    best_distance = -math.inf

    for i in range(grid):
        x = minx + width * (i + 0.5) / grid
        for j in range(grid):
            y = miny + height * (j + 0.5) / grid
            if not point_in_ring(x, y, ring):
                continue
            d = distance_to_ring(x, y, ring)
            if d > best_distance:
                best_distance = d
                best_point = (x, y)

    if math.isinf(best_distance):
        # Polígono extremadamente fino: usar el vértice más alejado del bbox.
        cx, cy = best_point
        best_point = max(ring, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    return best_point


def clean_coords(coords: list[list[float]]) -> list[list[float]]:
    cleaned: list[list[float]] = []
    for point in coords:
        if not cleaned or point != cleaned[-1]:
            cleaned.append(point)
    if len(cleaned) > 1 and cleaned[0] == cleaned[-1]:
        cleaned.pop()
    return cleaned


# ---------------------------------------------------------------------------
# Construcción
# ---------------------------------------------------------------------------


def load_features() -> dict[str, dict]:
    with SOURCE_FILE.open("r", encoding="utf-8-sig") as handle:
        collection = json.load(handle)

    features = collection.get("features", [])
    if len(features) != 18:
        raise SystemExit(f"Se esperaban 18 unidades (17 departamentos + Asunción); hay {len(features)}.")

    indexed: dict[str, dict] = {}
    for feature in features:
        key = normalize_name(feature["properties"]["shapeName"])
        if key in indexed:
            raise SystemExit(f"Unidad duplicada en la fuente: {key}")
        indexed[key] = feature

    expected = set(DEPARTMENTS) | {ASUNCION_KEY}
    missing = expected - set(indexed)
    extra = set(indexed) - expected
    if missing:
        raise SystemExit(f"Faltan unidades en la fuente: {sorted(missing)}")
    if extra:
        raise SystemExit(f"Unidades desconocidas en la fuente: {sorted(extra)}")
    return indexed


def build() -> str:
    features = load_features()

    # 1. Recolectar puntos proyectados crudos y calcular la escala única.
    raw_features: dict[str, list[list[tuple[float, float]]]] = {}
    all_points: list[tuple[float, float]] = []
    for key, feature in features.items():
        rings: list[list[tuple[float, float]]] = []
        for ring in iter_rings(feature):
            projected = [project_raw(lon, lat) for lon, lat in ring]
            rings.append(projected)
            all_points.extend(projected)
        raw_features[key] = rings

    minx = min(p[0] for p in all_points)
    maxx = max(p[0] for p in all_points)
    miny = min(p[1] for p in all_points)
    maxy = max(p[1] for p in all_points)
    scale = (MAP_WIDTH - 2 * PADDING) / (maxx - minx)
    map_height = (maxy - miny) * scale + 2 * PADDING

    def to_map(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return ((x - minx) * scale + PADDING, (maxy - y) * scale + PADDING)

    def project_lonlat(lon: float, lat: float) -> tuple[float, float]:
        return to_map(project_raw(lon, lat))

    def ring_to_map(ring: list[tuple[float, float]]) -> list[list[float]]:
        return [[round(x, 1), round(y, 1)] for x, y in (to_map(p) for p in ring)]

    def ring_to_path(ring: list[list[float]]) -> str:
        if not ring:
            return ""
        parts = [f"M{ring[0][0]:g} {ring[0][1]:g}"]
        for x, y in ring[1:]:
            parts.append(f"L{x:g} {y:g}")
        parts.append("Z")
        return "".join(parts)

    # 2. Departamentos.
    departments = []
    for key, meta in DEPARTMENTS.items():
        feature = features[key]
        rings = [ring_to_map(ring) for ring in raw_features[key]]
        path = "".join(ring_to_path(ring) for ring in rings)
        anchor = label_anchor(rings[0])
        dx, dy = LABEL_OFFSETS.get(meta["id"], (0.0, 0.0))
        capital_point = project_lonlat(meta["capitalLon"], meta["capitalLat"])
        inside = point_in_feature(meta["capitalLon"], meta["capitalLat"], feature)
        if not inside:
            print(f"  AVISO: la capital {meta['capital']} queda fuera del polígono simplificado.")

        number = NATIONAL_NUMBERS.get(meta["id"])
        if number is None:
            raise SystemExit(f"Falta el número departamental de {meta['name']}.")

        departments.append(
            {
                "id": meta["id"],
                "number": number,
                "name": meta["name"],
                "capital": meta["capital"],
                "region": meta["region"],
                "areaKm2": meta["areaKm2"],
                "path": path,
                "label": [round(anchor[0] + dx, 1), round(anchor[1] + dy, 1)],
                "anchor": [round(anchor[0], 1), round(anchor[1], 1)],
                "leader": meta["id"] == "central",
                "capitalPoint": [round(capital_point[0], 1), round(capital_point[1], 1)],
            }
        )

    departments.sort(key=lambda item: normalize_name(item["name"]))
    if len(departments) != 17:
        raise SystemExit("El mapa debe tener exactamente 17 departamentos.")
    numbers = sorted(item["number"] for item in departments)
    if numbers != list(range(1, 18)):
        raise SystemExit(f"La numeración departamental debe ser 1–17; se obtuvo {numbers}.")

    # 3. Asunción.
    asuncion_feature = features[ASUNCION_KEY]
    asuncion_rings = [ring_to_map(ring) for ring in raw_features[ASUNCION_KEY]]
    asuncion_anchor = label_anchor(asuncion_rings[0])
    asuncion_label = (
        asuncion_anchor[0] + ASUNCION_LABEL_OFFSET[0],
        asuncion_anchor[1] + ASUNCION_LABEL_OFFSET[1],
    )
    asuncion_point = project_lonlat(ASUNCION["capitalLon"], ASUNCION["capitalLat"])
    asuncion = {
        "name": ASUNCION["name"],
        "note": ASUNCION["note"],
        "path": "".join(ring_to_path(ring) for ring in asuncion_rings),
        "label": [round(asuncion_label[0], 1), round(asuncion_label[1], 1)],
        "anchor": [round(asuncion_anchor[0], 1), round(asuncion_anchor[1], 1)],
        "capitalPoint": [round(asuncion_point[0], 1), round(asuncion_point[1], 1)],
    }

    # 4. Comprobaciones de integridad.
    total_area = sum(item["areaKm2"] for item in departments)
    if not 405000 <= total_area <= 408000:
        raise SystemExit(f"Superficie total inesperada: {total_area} km²")

    data = {
        "width": round(MAP_WIDTH, 1),
        "height": round(map_height, 1),
        "projection": "Albers Equal Area",
        "source": {
            "name": "geoBoundaries gbOpen · Paraguay ADM1 (simplified)",
            "url": "https://www.geoboundaries.org/",
            "license": "CC BY 4.0",
            "original": "Dirección General de Estadística, Encuestas y Censos (DGEEC), Paraguay, 2012",
        },
        "departments": departments,
        "district": asuncion,
    }

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    header = (
        "/* Generado por tools/build_map.py. No editar a mano.\n"
        " * Límites: geoBoundaries gbOpen (CC BY 4.0), fuente DGEEC Paraguay 2012.\n"
        " * Proyección Albers Equal Area con escala única.\n"
        " */\n"
        "(function (root, factory) {\n"
        "  if (typeof module === 'object' && module.exports) module.exports = factory();\n"
        "  else root.PARAGUAY_DATA = factory();\n"
        "})(typeof self !== 'undefined' ? self : this, function () {\n"
        "  'use strict';\n"
        f"  return {payload};\n"
        "});\n"
    )
    print(
        f"Mapa: {len(departments)} departamentos + Asunción · "
        f"viewBox {MAP_WIDTH:g}×{map_height:.1f} · "
        f"{len(payload):,} bytes de datos"
    )
    print(f"Aspecto (ancho/alto): {MAP_WIDTH / map_height:.3f}")
    return header


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera map-data.js para el juego de Paraguay.")
    parser.add_argument("--check", action="store_true", help="Verifica que map-data.js esté actualizado.")
    parser.add_argument("--refresh", action="store_true", help="Vuelve a descargar la fuente.")
    args = parser.parse_args()

    fetch_source(force=args.refresh)
    output = build()

    if args.check:
        if not OUTPUT_FILE.exists():
            print("ERROR: falta map-data.js.")
            return 1
        current = OUTPUT_FILE.read_text(encoding="utf-8")
        if current != output:
            print("ERROR: map-data.js está desactualizado. Ejecuta build_map.py.")
            return 1
        print("OK: map-data.js coincide con la fuente.")
        return 0

    OUTPUT_FILE.write_text(output, encoding="utf-8", newline="\n")
    print(f"Escrito: {OUTPUT_FILE.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
