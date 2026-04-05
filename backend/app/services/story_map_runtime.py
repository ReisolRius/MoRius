from __future__ import annotations

import math
import random
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import StoryGame, StoryMessage
from app.schemas import (
    StoryMapLocationOut,
    StoryMapPoiOut,
    StoryMapPointOut,
    StoryMapRouteOut,
    StoryMapStateOut,
    StoryMapTravelLogEntryOut,
    StoryMapTravelModeOut,
    StoryMapTravelPreviewOut,
    StoryMapTravelStepOut,
)
from app.services import story_map as legacy_story_map
from app.services.story_games import (
    deserialize_story_environment_datetime,
    normalize_story_environment_enabled,
    serialize_story_environment_datetime,
)
from app.services.story_queries import touch_story_game


STORY_MAP_RUNTIME_LAYOUT_VERSION = 2
STORY_MAP_RUNTIME_CANVAS_WIDTH = 4096
STORY_MAP_RUNTIME_CANVAS_HEIGHT = 2560
STORY_MAP_GENERIC_LOCATION_NAMES = {
    "действие",
    "сцена",
    "место",
    "локация",
    "location",
    "scene",
    "place",
}


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def _runtime_rng(seed: str, salt: str) -> random.Random:
    return random.Random(f"{seed}:{salt}")


def _point_xy(point: StoryMapPointOut) -> tuple[float, float]:
    return float(point.x), float(point.y)


def _polygon_bounds(points: list[StoryMapPointOut]) -> tuple[float, float, float, float]:
    xs = [float(point.x) for point in points]
    ys = [float(point.y) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _point_in_polygon(x: float, y: float, polygon: list[StoryMapPointOut]) -> bool:
    is_inside = False
    previous_x, previous_y = _point_xy(polygon[-1])
    for point in polygon:
        current_x, current_y = _point_xy(point)
        intersects = ((current_y > y) != (previous_y > y)) and (
            x < (previous_x - current_x) * (y - current_y) / ((previous_y - current_y) or 1e-9) + current_x
        )
        if intersects:
            is_inside = not is_inside
        previous_x, previous_y = current_x, current_y
    return is_inside


def _sample_point_in_polygon(
    rng: random.Random,
    polygon: list[StoryMapPointOut],
    *,
    preferred_x: float | None = None,
    preferred_y: float | None = None,
    preferred_radius_x: float = 160.0,
    preferred_radius_y: float = 120.0,
    occupied: list[tuple[float, float]] | None = None,
    min_distance: float = 90.0,
) -> tuple[float, float]:
    occupied_points = occupied or []
    min_x, min_y, max_x, max_y = _polygon_bounds(polygon)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    for attempt_index in range(180):
        if attempt_index < 100 and preferred_x is not None and preferred_y is not None:
            next_x = preferred_x + rng.uniform(-preferred_radius_x, preferred_radius_x)
            next_y = preferred_y + rng.uniform(-preferred_radius_y, preferred_radius_y)
        else:
            next_x = rng.uniform(min_x, max_x)
            next_y = rng.uniform(min_y, max_y)
        if not _point_in_polygon(next_x, next_y, polygon):
            continue
        if any(math.dist((next_x, next_y), other_point) < min_distance for other_point in occupied_points):
            continue
        return next_x, next_y
    return center_x, center_y


def _location_runtime_min_distance(location: StoryMapLocationOut) -> float:
    if location.kind == "capital":
        return 190.0
    if location.kind in {"city", "port", "fort"}:
        return 145.0
    if location.kind == "town":
        return 120.0
    return 92.0


def _route_runtime_difficulty(route_kind: str) -> float:
    if route_kind in {"road", "service", "maglev", "rail"}:
        return 1.0
    if route_kind in {"pass", "trail", "causeway"}:
        return 1.26
    return 1.14


def _runtime_region_centers(seed: str, region_count: int) -> list[tuple[float, float]]:
    rng = _runtime_rng(seed, "layout-v2-regions")
    width = float(STORY_MAP_RUNTIME_CANVAS_WIDTH)
    height = float(STORY_MAP_RUNTIME_CANVAS_HEIGHT)
    continent_specs = [
        {
            "cx": width * 0.27 + rng.uniform(-180, 120),
            "cy": height * 0.48 + rng.uniform(-120, 120),
            "rx": width * 0.2,
            "ry": height * 0.24,
        },
        {
            "cx": width * 0.58 + rng.uniform(-160, 180),
            "cy": height * 0.34 + rng.uniform(-140, 110),
            "rx": width * 0.24,
            "ry": height * 0.22,
        },
        {
            "cx": width * 0.76 + rng.uniform(-120, 120),
            "cy": height * 0.66 + rng.uniform(-110, 120),
            "rx": width * 0.17,
            "ry": height * 0.2,
        },
    ]
    candidates: list[tuple[float, float, float]] = []
    for grid_x in range(16):
        for grid_y in range(11):
            next_x = width * (0.08 + 0.84 * ((grid_x + rng.random() * 0.84) / 15))
            next_y = height * (0.1 + 0.78 * ((grid_y + rng.random() * 0.88) / 10))
            best_score = -10.0
            for spec in continent_specs:
                dx = (next_x - float(spec["cx"])) / float(spec["rx"])
                dy = (next_y - float(spec["cy"])) / float(spec["ry"])
                best_score = max(best_score, 1.18 - (dx * dx + dy * dy))
            if best_score > -0.06:
                candidates.append((next_x, next_y, best_score + rng.random() * 0.18))

    if not candidates:
        candidates = [(width * 0.28, height * 0.5, 1.0), (width * 0.58, height * 0.34, 0.9), (width * 0.74, height * 0.68, 0.8)]

    selected: list[tuple[float, float]] = []
    start_target = (width * 0.24, height * 0.5)
    first_center = min(candidates, key=lambda item: math.dist((item[0], item[1]), start_target))
    selected.append((first_center[0], first_center[1]))

    while len(selected) < region_count:
        best_candidate: tuple[float, float] | None = None
        best_value = -10_000.0
        for candidate_x, candidate_y, candidate_score in candidates:
            if any(math.dist((candidate_x, candidate_y), point) < 360.0 for point in selected):
                continue
            nearest_distance = min(math.dist((candidate_x, candidate_y), point) for point in selected)
            candidate_value = nearest_distance + candidate_score * 240.0
            if candidate_value > best_value:
                best_value = candidate_value
                best_candidate = (candidate_x, candidate_y)
        if best_candidate is None:
            break
        selected.append(best_candidate)

    while len(selected) < region_count:
        selected.append(
            (
                width * rng.uniform(0.14, 0.86),
                height * rng.uniform(0.16, 0.82),
            )
        )
    return selected[:region_count]


def _upgrade_story_map_layout(payload: StoryMapStateOut) -> StoryMapStateOut:
    if int(getattr(payload, "layout_version", 1) or 1) >= STORY_MAP_RUNTIME_LAYOUT_VERSION:
        return payload

    next_payload = payload.model_copy(deep=True)
    next_payload.layout_version = STORY_MAP_RUNTIME_LAYOUT_VERSION
    next_payload.canvas_width = STORY_MAP_RUNTIME_CANVAS_WIDTH
    next_payload.canvas_height = STORY_MAP_RUNTIME_CANVAS_HEIGHT

    rename_rng = _runtime_rng(next_payload.seed, "layout-v2-names")
    seen_location_names: set[str] = set()
    for location in next_payload.locations:
        normalized_name = str(location.name or "").strip()
        if not normalized_name or normalized_name.casefold() in STORY_MAP_GENERIC_LOCATION_NAMES:
            replacement_name = ""
            for _ in range(20):
                candidate_name = legacy_story_map._pick_name(rename_rng, theme=next_payload.theme, bucket="city")
                if candidate_name.casefold() not in seen_location_names:
                    replacement_name = candidate_name
                    break
            location.name = replacement_name or normalized_name or f"Point {location.id}"
        seen_location_names.add(location.name.casefold())

    region_centers = _runtime_region_centers(next_payload.seed, len(next_payload.regions))
    region_locations: dict[str, list[StoryMapLocationOut]] = {}
    for location in next_payload.locations:
        region_locations.setdefault(location.region_id or "", []).append(location)
    region_landmarks: dict[str, list[Any]] = {}
    for landmark in next_payload.landmarks:
        region_landmarks.setdefault(landmark.region_id or "", []).append(landmark)

    for region_index, region in enumerate(next_payload.regions):
        center_x, center_y = region_centers[region_index]
        local_rng = _runtime_rng(next_payload.seed, f"layout-v2-region-{region.id}")
        neighbor_distances = [
            math.dist((center_x, center_y), other_center)
            for other_index, other_center in enumerate(region_centers)
            if other_index != region_index
        ]
        base_radius = clamp((min(neighbor_distances) if neighbor_distances else 720.0) * 0.56, 290.0, 470.0)
        region.polygon = [
            StoryMapPointOut.model_validate(point)
            for point in legacy_story_map._region_blob_polygon(center_x, center_y, rng=local_rng, radius=base_radius)
        ]

        polygon_points = region.polygon
        if len(polygon_points) < 3:
            continue
        polygon_vertices = [_point_xy(point) for point in polygon_points]
        centroid_x = sum(point[0] for point in polygon_vertices) / len(polygon_vertices)
        centroid_y = sum(point[1] for point in polygon_vertices) / len(polygon_vertices)
        edge_targets = list(
            {
                (
                    min(polygon_vertices, key=lambda point: point[0])[0],
                    min(polygon_vertices, key=lambda point: point[0])[1],
                ),
                (
                    max(polygon_vertices, key=lambda point: point[0])[0],
                    max(polygon_vertices, key=lambda point: point[0])[1],
                ),
                (
                    min(polygon_vertices, key=lambda point: point[1])[0],
                    min(polygon_vertices, key=lambda point: point[1])[1],
                ),
                (
                    max(polygon_vertices, key=lambda point: point[1])[0],
                    max(polygon_vertices, key=lambda point: point[1])[1],
                ),
            }
        )

        occupied_points: list[tuple[float, float]] = []
        current_region_locations = sorted(
            region_locations.get(region.id, []),
            key=lambda item: int(item.importance or 0),
            reverse=True,
        )
        for location_index, location in enumerate(current_region_locations):
            preferred_target = edge_targets[location_index % len(edge_targets)] if edge_targets else (centroid_x, centroid_y)
            preferred_x = centroid_x
            preferred_y = centroid_y
            radius_x = 170.0
            radius_y = 130.0
            if location.kind == "port":
                preferred_x = centroid_x + (preferred_target[0] - centroid_x) * local_rng.uniform(0.72, 0.94)
                preferred_y = centroid_y + (preferred_target[1] - centroid_y) * local_rng.uniform(0.72, 0.94)
                radius_x = 56.0
                radius_y = 56.0
            elif location.kind == "fort":
                preferred_x = centroid_x + (preferred_target[0] - centroid_x) * local_rng.uniform(0.66, 0.9)
                preferred_y = centroid_y + (preferred_target[1] - centroid_y) * local_rng.uniform(0.66, 0.9)
                radius_x = 72.0
                radius_y = 72.0
            elif location.kind in {"city", "town"}:
                preferred_x = centroid_x + (preferred_target[0] - centroid_x) * local_rng.uniform(0.34, 0.74)
                preferred_y = centroid_y + (preferred_target[1] - centroid_y) * local_rng.uniform(0.34, 0.74)
                radius_x = 92.0
                radius_y = 84.0
            elif location.kind == "village":
                preferred_x = centroid_x + (preferred_target[0] - centroid_x) * local_rng.uniform(0.48, 0.88)
                preferred_y = centroid_y + (preferred_target[1] - centroid_y) * local_rng.uniform(0.48, 0.88)
                radius_x = 96.0
                radius_y = 92.0
            placed_x, placed_y = _sample_point_in_polygon(
                local_rng,
                polygon_points,
                preferred_x=preferred_x,
                preferred_y=preferred_y,
                preferred_radius_x=radius_x,
                preferred_radius_y=radius_y,
                occupied=occupied_points,
                min_distance=_location_runtime_min_distance(location),
            )
            location.x = round(placed_x, 2)
            location.y = round(placed_y, 2)
            occupied_points.append((location.x, location.y))

        for landmark_index, landmark in enumerate(region_landmarks.get(region.id, [])):
            preferred_target = edge_targets[landmark_index % len(edge_targets)] if edge_targets else (centroid_x, centroid_y)
            preferred_x = centroid_x + (preferred_target[0] - centroid_x) * local_rng.uniform(0.36, 0.86)
            preferred_y = centroid_y + (preferred_target[1] - centroid_y) * local_rng.uniform(0.36, 0.86)
            placed_x, placed_y = _sample_point_in_polygon(
                local_rng,
                polygon_points,
                preferred_x=preferred_x,
                preferred_y=preferred_y,
                preferred_radius_x=84.0,
                preferred_radius_y=84.0,
                occupied=occupied_points,
                min_distance=88.0,
            )
            landmark.x = round(placed_x, 2)
            landmark.y = round(placed_y, 2)
            occupied_points.append((landmark.x, landmark.y))

    route_rng = _runtime_rng(next_payload.seed, "layout-v2-routes")
    seen_route_pairs: set[tuple[str, str]] = set()
    route_items: list[StoryMapRouteOut] = []
    route_index = 1

    def append_route(left_location: StoryMapLocationOut, right_location: StoryMapLocationOut, *, intra_region: bool) -> None:
        nonlocal route_index
        location_pair = tuple(sorted((left_location.id, right_location.id)))
        if left_location.id == right_location.id or location_pair in seen_route_pairs:
            return
        seen_route_pairs.add(location_pair)
        route_kind = legacy_story_map._route_kind_for_theme(next_payload.theme, intra_region=intra_region, rng=route_rng)
        difficulty = _route_runtime_difficulty(route_kind)
        start_x = float(left_location.x)
        start_y = float(left_location.y)
        end_x = float(right_location.x)
        end_y = float(right_location.y)
        mid_x = (start_x + end_x) / 2 + route_rng.uniform(-96, 96)
        mid_y = (start_y + end_y) / 2 + route_rng.uniform(-72, 72)
        distance = math.dist((start_x, start_y), (mid_x, mid_y)) + math.dist((mid_x, mid_y), (end_x, end_y))
        travel_minutes = max(int(round(distance * 0.34 * difficulty)), 28 if intra_region else 64)
        route_items.append(
            StoryMapRouteOut.model_validate(
                {
                    "id": f"route-{route_index}",
                    "from_location_id": left_location.id,
                    "to_location_id": right_location.id,
                    "kind": route_kind,
                    "travel_minutes": travel_minutes,
                    "difficulty": round(max(difficulty, 0.8), 2),
                    "path": [
                        StoryMapPointOut.model_validate(legacy_story_map._point(start_x, start_y)),
                        StoryMapPointOut.model_validate(legacy_story_map._point(mid_x, mid_y)),
                        StoryMapPointOut.model_validate(legacy_story_map._point(end_x, end_y)),
                    ],
                }
            )
        )
        route_index += 1

    grouped_locations = [group for group in region_locations.values() if group]
    for current_region_locations in grouped_locations:
        if len(current_region_locations) < 2:
            continue
        ordered_locations = sorted(current_region_locations, key=lambda item: int(item.importance or 0), reverse=True)
        hub_location = next((item for item in ordered_locations if item.kind == "capital"), ordered_locations[0])
        connected_locations: list[StoryMapLocationOut] = [hub_location]
        for location in ordered_locations:
            if location.id == hub_location.id:
                continue
            nearest_location = min(
                connected_locations,
                key=lambda item: math.dist((float(item.x), float(item.y)), (float(location.x), float(location.y))),
            )
            append_route(nearest_location, location, intra_region=True)
            if location.kind != "village" or len(connected_locations) < 4:
                connected_locations.append(location)

        extra_edges: list[tuple[float, StoryMapLocationOut, StoryMapLocationOut]] = []
        for left_index, left_location in enumerate(ordered_locations):
            for right_location in ordered_locations[left_index + 1 :]:
                if left_location.kind == "village" and right_location.kind == "village":
                    continue
                extra_edges.append(
                    (
                        math.dist((float(left_location.x), float(left_location.y)), (float(right_location.x), float(right_location.y))),
                        left_location,
                        right_location,
                    )
                )
        extra_edges.sort(key=lambda item: item[0])
        extra_budget = max(2, len(ordered_locations) // 4)
        for _, left_location, right_location in extra_edges[: extra_budget * 4]:
            if extra_budget <= 0:
                break
            pair = tuple(sorted((left_location.id, right_location.id)))
            if pair in seen_route_pairs:
                continue
            append_route(left_location, right_location, intra_region=True)
            extra_budget -= 1

    region_hubs = [
        next(
            (location for location in sorted(group, key=lambda item: int(item.importance or 0), reverse=True) if location.kind == "capital"),
            sorted(group, key=lambda item: int(item.importance or 0), reverse=True)[0],
        )
        for group in grouped_locations
    ]
    if len(region_hubs) >= 2:
        parent: dict[str, str] = {location.id: location.id for location in region_hubs}

        def find_parent(location_id: str) -> str:
            while parent[location_id] != location_id:
                parent[location_id] = parent[parent[location_id]]
                location_id = parent[location_id]
            return location_id

        def union(left_id: str, right_id: str) -> bool:
            left_root = find_parent(left_id)
            right_root = find_parent(right_id)
            if left_root == right_root:
                return False
            parent[right_root] = left_root
            return True

        hub_edges: list[tuple[float, StoryMapLocationOut, StoryMapLocationOut]] = []
        for left_index, left_hub in enumerate(region_hubs):
            for right_hub in region_hubs[left_index + 1 :]:
                hub_edges.append(
                    (
                        math.dist((float(left_hub.x), float(left_hub.y)), (float(right_hub.x), float(right_hub.y))),
                        left_hub,
                        right_hub,
                    )
                )
        hub_edges.sort(key=lambda item: item[0])
        for _, left_hub, right_hub in hub_edges:
            if union(left_hub.id, right_hub.id):
                append_route(left_hub, right_hub, intra_region=False)

        extra_budget = max(2, len(region_hubs) // 3)
        for distance_value, left_hub, right_hub in hub_edges:
            if extra_budget <= 0 or distance_value > STORY_MAP_RUNTIME_CANVAS_WIDTH * 0.42:
                break
            pair = tuple(sorted((left_hub.id, right_hub.id)))
            if pair in seen_route_pairs:
                continue
            append_route(left_hub, right_hub, intra_region=False)
            extra_budget -= 1

    next_payload.routes = route_items
    current_location = next((location for location in next_payload.locations if location.id == next_payload.current_location_id), None)
    current_poi = next((poi for poi in next_payload.pois if poi.id == next_payload.current_poi_id), None)
    if current_location is not None:
        next_payload.current_location_label = current_location.name
        next_payload.current_region_id = current_location.region_id
    if current_poi is not None:
        next_payload.current_poi_label = current_poi.name
    if next_payload.current_anchor_scope == "location":
        _set_anchor_from_location(next_payload, current_location)
    elif next_payload.current_anchor_scope == "poi":
        _set_anchor_from_poi(next_payload, current_poi)
    return next_payload


def story_map_payload_to_out(*, is_enabled: bool, raw_payload: str | None) -> StoryMapStateOut | None:
    payload = legacy_story_map.story_map_payload_to_out(is_enabled=is_enabled, raw_payload=raw_payload)
    if payload is None or not payload.is_enabled:
        return payload
    return _upgrade_story_map_layout(payload)


def initialize_story_map_for_game(
    *,
    game: StoryGame,
    world_description: str,
    start_location: str,
    theme: str | None = None,
) -> StoryMapStateOut:
    normalized_start_location = legacy_story_map._normalize_text(start_location, max_length=160)
    if normalized_start_location.casefold() in STORY_MAP_GENERIC_LOCATION_NAMES:
        normalized_start_location = ""
    legacy_story_map.initialize_story_map_for_game(
        game=game,
        world_description=world_description,
        start_location=normalized_start_location or start_location,
        theme=theme,
    )
    payload = story_map_payload_to_out(is_enabled=True, raw_payload=str(getattr(game, "story_map_payload", "") or ""))
    if payload is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to initialize story map")
    game.story_map_payload = payload.model_dump_json()
    return payload


def disable_story_map_for_game(*, game: StoryGame) -> None:
    legacy_story_map.disable_story_map_for_game(game=game)


def get_story_map_state_or_400(game: StoryGame) -> StoryMapStateOut:
    raw_payload = str(getattr(game, "story_map_payload", "") or "")
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=raw_payload,
    )
    if payload is None or not payload.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story map is disabled")
    next_raw_payload = payload.model_dump_json()
    if next_raw_payload != raw_payload:
        game.story_map_payload = next_raw_payload
    return payload


def _theme_travel_mode_catalog(theme: str) -> list[dict[str, Any]]:
    catalogs: dict[str, list[dict[str, Any]]] = {
        legacy_story_map.STORY_MAP_THEME_FANTASY: [
            {"id": "walk", "label": "Пешком", "description": "Медленно, зато можно почти везде.", "speed_multiplier": 1.0},
            {
                "id": "horse",
                "label": "Верхом",
                "description": "Быстрее на дорогах, трактах и в открытой местности.",
                "speed_multiplier": 1.65,
            },
            {
                "id": "carriage",
                "label": "В экипаже",
                "description": "Комфортнее на хороших дорогах между крупными точками.",
                "speed_multiplier": 1.35,
            },
            {"id": "ship", "label": "Кораблем", "description": "Работает только там, где путь реально идет по воде.", "speed_multiplier": 2.4},
        ],
        legacy_story_map.STORY_MAP_THEME_CYBERPUNK: [
            {"id": "walk", "label": "Пешком", "description": "Надежно, но медленно.", "speed_multiplier": 1.0},
            {"id": "bike", "label": "На байке", "description": "Быстро по улицам и шоссе.", "speed_multiplier": 1.8},
            {
                "id": "car",
                "label": "На машине",
                "description": "Лучший вариант для городских и междугородних дорог.",
                "speed_multiplier": 2.35,
            },
            {"id": "maglev", "label": "На маглеве", "description": "Только по уже существующим маглев-линиям.", "speed_multiplier": 4.8},
        ],
        legacy_story_map.STORY_MAP_THEME_STEAMPUNK: [
            {"id": "walk", "label": "Пешком", "description": "Базовый вариант движения.", "speed_multiplier": 1.0},
            {"id": "horse", "label": "Верхом", "description": "Подходит для трактов и проселков.", "speed_multiplier": 1.55},
            {"id": "carriage", "label": "В экипаже", "description": "Неплох на дорогах и дамбах.", "speed_multiplier": 1.4},
            {"id": "rail", "label": "По железной дороге", "description": "Только там, где реально есть рельсы.", "speed_multiplier": 3.1},
            {"id": "airship", "label": "На дирижабле", "description": "Только по небесным линиям и платформам.", "speed_multiplier": 3.8},
        ],
        legacy_story_map.STORY_MAP_THEME_POSTAPOC: [
            {"id": "walk", "label": "Пешком", "description": "Самый универсальный способ.", "speed_multiplier": 1.0},
            {"id": "horse", "label": "Верхом", "description": "Хорош для разбитых дорог и троп.", "speed_multiplier": 1.5},
            {"id": "buggy", "label": "На багги", "description": "Эффективен по сухим трассам и сервисным дорогам.", "speed_multiplier": 2.0},
            {"id": "truck", "label": "На грузовике", "description": "Лучше всего по уцелевшим дорогам между опорными точками.", "speed_multiplier": 2.15},
        ],
    }
    return [dict(item) for item in catalogs.get(theme, catalogs[legacy_story_map.STORY_MAP_THEME_FANTASY])]


def _route_mode_factor(route_kind: str, mode_id: str) -> float | None:
    factors: dict[str, dict[str, float | None]] = {
        "walk": {"road": 1.0, "trail": 1.0, "pass": 0.88, "service": 1.0, "causeway": 0.96},
        "horse": {"road": 1.65, "trail": 1.35, "pass": 1.08, "service": 1.45, "causeway": 1.25},
        "carriage": {"road": 1.32, "trail": 0.82, "service": 1.42, "causeway": 1.2},
        "ship": {"river": 2.55, "canal": 2.25},
        "bike": {"road": 1.82, "trail": 1.08, "pass": 0.72, "service": 2.0, "causeway": 1.74},
        "car": {"road": 2.2, "trail": 0.58, "service": 2.45, "causeway": 2.0},
        "maglev": {"maglev": 4.8, "rail": 3.6},
        "rail": {"rail": 3.1, "maglev": 2.9},
        "airship": {"skyway": 3.8},
        "buggy": {"road": 1.85, "trail": 0.92, "service": 2.1, "causeway": 1.72},
        "truck": {"road": 1.95, "trail": 0.68, "service": 2.2, "causeway": 1.86},
    }
    route_key = str(route_kind or "").strip().lower()
    mode_factors = factors.get(mode_id, {})
    if route_key in mode_factors:
        return mode_factors[route_key]
    if route_key in {"road", "trail", "pass", "service", "causeway"}:
        return mode_factors.get("road")
    return None


def _local_mode_factor(mode_id: str) -> float | None:
    return {
        "walk": 1.0,
        "horse": 1.5,
        "carriage": 1.18,
        "bike": 1.72,
        "car": 1.9,
        "buggy": 1.72,
        "truck": 1.58,
    }.get(mode_id)


def _route_modes_for_path(payload: StoryMapStateOut, route_path: list[StoryMapRouteOut]) -> list[StoryMapTravelModeOut]:
    options: list[StoryMapTravelModeOut] = []
    for item in _theme_travel_mode_catalog(payload.theme):
        mode_id = str(item.get("id") or "").strip().lower()
        if not mode_id:
            continue
        if route_path and not all(_route_mode_factor(route.kind, mode_id) is not None for route in route_path):
            continue
        options.append(
            StoryMapTravelModeOut(
                id=mode_id,
                label=str(item.get("label") or mode_id),
                description=str(item.get("description") or ""),
                speed_multiplier=max(float(item.get("speed_multiplier") or 1.0), 0.1),
                is_default=False,
            )
        )
    if not options:
        options.append(StoryMapTravelModeOut(id="walk", label="Пешком", description="Режим по умолчанию.", speed_multiplier=1.0, is_default=False))
    return options


def _local_modes(payload: StoryMapStateOut) -> list[StoryMapTravelModeOut]:
    options: list[StoryMapTravelModeOut] = []
    for item in _theme_travel_mode_catalog(payload.theme):
        mode_id = str(item.get("id") or "").strip().lower()
        if not mode_id or _local_mode_factor(mode_id) is None:
            continue
        options.append(
            StoryMapTravelModeOut(
                id=mode_id,
                label=str(item.get("label") or mode_id),
                description=str(item.get("description") or ""),
                speed_multiplier=max(float(item.get("speed_multiplier") or 1.0), 0.1),
                is_default=False,
            )
        )
    if not options:
        options.append(StoryMapTravelModeOut(id="walk", label="Пешком", description="Режим по умолчанию.", speed_multiplier=1.0, is_default=False))
    return options


def _select_travel_mode(
    requested_mode: str | None,
    options: list[StoryMapTravelModeOut],
) -> tuple[str, str, list[StoryMapTravelModeOut]]:
    normalized_requested_mode = legacy_story_map._normalize_text(requested_mode, max_length=32).lower()
    resolved_mode = next((option for option in options if option.id == normalized_requested_mode), None) or options[0]
    normalized_options = [
        StoryMapTravelModeOut(
            id=option.id,
            label=option.label,
            description=option.description,
            speed_multiplier=option.speed_multiplier,
            is_default=(option.id == resolved_mode.id),
        )
        for option in options
    ]
    return resolved_mode.id, resolved_mode.label, normalized_options


def _apply_route_mode_minutes(route_path: list[StoryMapRouteOut], mode_id: str) -> int | None:
    adjusted_minutes = 0.0
    for route in route_path:
        factor = _route_mode_factor(route.kind, mode_id)
        if factor is None or factor <= 0:
            return None
        adjusted_minutes += max(int(route.travel_minutes or 0), 1) / factor
    return max(int(round(adjusted_minutes)), 0)


def _apply_local_mode_minutes(base_travel_minutes: int, mode_id: str) -> int:
    factor = _local_mode_factor(mode_id) or 1.0
    return max(int(round(max(int(base_travel_minutes), 0) / factor)), 0)


def _estimate_arrival_datetime(game: StoryGame, *, travel_minutes: int) -> str | None:
    if not normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        return None
    current_datetime = deserialize_story_environment_datetime(str(getattr(game, "environment_current_datetime", "") or ""))
    if current_datetime is None:
        return None
    return serialize_story_environment_datetime(current_datetime + timedelta(minutes=max(int(travel_minutes), 0)))


def _minutes_to_km(travel_minutes: int) -> float:
    return round(max(float(travel_minutes), 0.0) / 12.0, 1)


def _location_radius(location: StoryMapLocationOut) -> float:
    return max(110.0, min(280.0, 78.0 + max(int(location.importance or 0), 0) * 1.55))


def _current_anchor(
    payload: StoryMapStateOut,
    current_location: StoryMapLocationOut | None,
    current_poi: StoryMapPoiOut | None,
) -> tuple[float, float]:
    if payload.current_anchor_x is not None and payload.current_anchor_y is not None:
        return payload.current_anchor_x, payload.current_anchor_y
    if current_poi is not None:
        return current_poi.x, current_poi.y
    if current_location is not None:
        return current_location.x, current_location.y
    return 0.0, 0.0


def _waypoint_label(
    location: StoryMapLocationOut,
    *,
    destination_label: str | None,
    destination_x: float,
    destination_y: float,
) -> str:
    normalized_label = legacy_story_map._normalize_text(destination_label, max_length=160)
    if normalized_label:
        return normalized_label
    angle = math.degrees(math.atan2(destination_y - location.y, destination_x - location.x))
    if -45 <= angle < 45:
        direction = "восточная часть"
    elif 45 <= angle < 135:
        direction = "южная часть"
    elif angle >= 135 or angle < -135:
        direction = "западная часть"
    else:
        direction = "северная часть"
    return f"{direction} {location.name}".strip()


def _location_anchor_point(
    payload: StoryMapStateOut,
    location: StoryMapLocationOut | None,
) -> tuple[float | None, float | None, str]:
    if location is None:
        return None, None, ""
    if location.kind not in {"capital", "city", "port", "fort", "village", "town"}:
        return location.x, location.y, location.name

    location_by_id = {item.id: item for item in payload.locations}
    connected_neighbors: list[StoryMapLocationOut] = []
    for route in payload.routes:
        if route.from_location_id == location.id:
            other_location = location_by_id.get(route.to_location_id)
        elif route.to_location_id == location.id:
            other_location = location_by_id.get(route.from_location_id)
        else:
            other_location = None
        if other_location is not None:
            connected_neighbors.append(other_location)

    if connected_neighbors:
        nearest_neighbor = min(
            connected_neighbors,
            key=lambda item: legacy_story_map._story_map_distance(location.x, location.y, item.x, item.y),
        )
        angle = math.atan2(nearest_neighbor.y - location.y, nearest_neighbor.x - location.x)
    else:
        fallback_rng = _runtime_rng(payload.seed, f"location-anchor:{location.id}")
        angle = fallback_rng.uniform(-math.pi, math.pi)

    radius = clamp(_location_radius(location) * 0.56, 54.0, 148.0)
    anchor_x = location.x + math.cos(angle) * radius
    anchor_y = location.y + math.sin(angle) * radius * 0.82
    if location.kind in {"capital", "city", "port", "fort"}:
        anchor_label = f"Подступы к {location.name}".strip()
    elif location.kind in {"village", "town"}:
        anchor_label = f"Окраина {location.name}".strip()
    else:
        anchor_label = location.name
    return round(anchor_x, 2), round(anchor_y, 2), anchor_label


def _set_anchor_from_location(payload: StoryMapStateOut, location: StoryMapLocationOut | None) -> None:
    if location is None:
        payload.current_anchor_x = None
        payload.current_anchor_y = None
        payload.current_anchor_label = ""
        payload.current_anchor_scope = "location"
        return
    anchor_x, anchor_y, anchor_label = _location_anchor_point(payload, location)
    payload.current_anchor_x = anchor_x
    payload.current_anchor_y = anchor_y
    payload.current_anchor_label = anchor_label or location.name
    payload.current_anchor_scope = "location"


def _set_anchor_from_poi(payload: StoryMapStateOut, poi: StoryMapPoiOut | None) -> None:
    if poi is None:
        return
    payload.current_anchor_x = poi.x
    payload.current_anchor_y = poi.y
    payload.current_anchor_label = poi.name
    payload.current_anchor_scope = "poi"


def _set_anchor_from_waypoint(payload: StoryMapStateOut, *, x: float, y: float, label: str) -> None:
    payload.current_anchor_x = float(x)
    payload.current_anchor_y = float(y)
    payload.current_anchor_label = legacy_story_map._normalize_text(label, max_length=160)
    payload.current_anchor_scope = "waypoint"


def _route_steps(
    route_path: list[StoryMapRouteOut],
    location_by_id: dict[str, StoryMapLocationOut],
) -> list[StoryMapTravelStepOut]:
    steps: list[StoryMapTravelStepOut] = []
    for route in route_path:
        from_location = location_by_id.get(route.from_location_id)
        to_location = location_by_id.get(route.to_location_id)
        steps.append(
            StoryMapTravelStepOut(
                route_id=route.id,
                from_location_id=route.from_location_id,
                to_location_id=route.to_location_id,
                from_name=from_location.name if from_location is not None else route.from_location_id,
                to_name=to_location.name if to_location is not None else route.to_location_id,
                kind=route.kind,
                travel_minutes=max(int(route.travel_minutes or 0), 0),
            )
        )
    return steps


def _route_detail(route_path: list[StoryMapRouteOut], destination_name: str) -> str:
    if not route_path:
        return f"Точка {destination_name} уже активна."
    if len(route_path) == 1:
        return f"Маршрут до {destination_name} найден по прямому пути."
    labels = [legacy_story_map._route_label_ru(route.kind) for route in route_path[:-1][:3]]
    readable = ", ".join(label for label in labels if label)
    if readable:
        return f"Маршрут до {destination_name} построен через {readable}."
    return f"Маршрут до {destination_name} построен."


def build_story_map_travel_preview(
    *,
    game: StoryGame,
    payload: StoryMapStateOut,
    destination_location_id: str | None,
    destination_poi_id: str | None = None,
    travel_mode: str | None = None,
    destination_x: float | None = None,
    destination_y: float | None = None,
    destination_label: str | None = None,
) -> StoryMapTravelPreviewOut:
    location_by_id = legacy_story_map._location_candidates_from_payload(payload)
    poi_by_id = legacy_story_map._story_map_poi_by_id(payload)
    normalized_destination_location_id = legacy_story_map._normalize_text(destination_location_id, max_length=48) or None
    normalized_destination_poi_id = legacy_story_map._normalize_text(destination_poi_id, max_length=48) or None
    destination_poi = poi_by_id.get(normalized_destination_poi_id or "") if normalized_destination_poi_id else None
    if destination_poi is not None and normalized_destination_location_id is None:
        normalized_destination_location_id = destination_poi.location_id
    destination = location_by_id.get(normalized_destination_location_id or "")
    current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
    current_poi = poi_by_id.get(payload.current_poi_id or "") if payload.current_poi_id else None
    weather_multiplier = legacy_story_map._weather_multiplier_for_game(game)
    environment_time_enabled = normalize_story_environment_enabled(getattr(game, "environment_enabled", None))

    if destination_x is not None and destination_y is not None:
        if current_location is None:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=normalized_destination_location_id or "",
                destination_label=legacy_story_map._normalize_text(destination_label, max_length=160),
                environment_time_enabled=environment_time_enabled,
                detail="Сначала нужно определить текущую локацию, а потом уже идти к свободной точке внутри нее.",
                scope="waypoint",
            )
        if destination is not None and destination.id != current_location.id:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=destination.id,
                destination_name=destination.name,
                destination_label=legacy_story_map._normalize_text(destination_label, max_length=160),
                from_location_id=current_location.id,
                from_location_name=current_location.name,
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                detail="Свободную точку можно выбрать только внутри текущей локации.",
                scope="waypoint",
            )
        allowed_radius = _location_radius(current_location)
        distance_from_center = legacy_story_map._story_map_distance(current_location.x, current_location.y, float(destination_x), float(destination_y))
        if distance_from_center > allowed_radius:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=current_location.id,
                destination_name=current_location.name,
                destination_label=_waypoint_label(current_location, destination_label=destination_label, destination_x=float(destination_x), destination_y=float(destination_y)),
                from_location_id=current_location.id,
                from_location_name=current_location.name,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                detail="Эта точка лежит вне доступной зоны текущей локации.",
                scope="waypoint",
            )
        local_modes = _local_modes(payload)
        resolved_mode_id, resolved_mode_label, resolved_modes = _select_travel_mode(travel_mode, local_modes)
        start_x, start_y = _current_anchor(payload, current_location, current_poi)
        distance_units = legacy_story_map._story_map_distance(start_x, start_y, float(destination_x), float(destination_y))
        base_travel_minutes = 0 if distance_units <= 2 else max(int(round(distance_units * 0.18)), 2)
        adjusted_travel_minutes = int(round(_apply_local_mode_minutes(base_travel_minutes, resolved_mode_id) * weather_multiplier))
        resolved_destination_label = _waypoint_label(current_location, destination_label=destination_label, destination_x=float(destination_x), destination_y=float(destination_y))
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=current_location.id,
            destination_name=current_location.name,
            destination_label=resolved_destination_label,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            from_poi_id=current_poi.id if current_poi is not None else None,
            from_poi_name=current_poi.name if current_poi is not None else "",
            route_ids=[],
            route_steps=[],
            base_travel_minutes=base_travel_minutes,
            adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            travel_mode=resolved_mode_id,
            travel_mode_label=resolved_mode_label,
            available_modes=resolved_modes,
            distance_km=0.0 if distance_units <= 2 else max(round(distance_units * 0.03, 1), 0.1),
            arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=adjusted_travel_minutes),
            detail="Эта точка уже активна." if base_travel_minutes <= 0 else "Маршрут по свободной точке внутри текущей локации построен.",
            scope="waypoint",
        )

    if destination_poi is not None:
        if destination is None:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=normalized_destination_location_id or "",
                destination_poi_id=normalized_destination_poi_id,
                destination_poi_name=destination_poi.name,
                destination_label=destination_poi.name,
                from_location_id=current_location.id if current_location is not None else None,
                from_location_name=current_location.name if current_location is not None else None,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                detail="Точка интереса не привязана к доступной локации.",
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                scope="poi",
            )
        if current_location is None or current_location.id != destination.location_id:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=destination.location_id,
                destination_name=destination.name,
                destination_poi_id=destination_poi.id,
                destination_poi_name=destination_poi.name,
                destination_label=destination_poi.name,
                from_location_id=current_location.id if current_location is not None else None,
                from_location_name=current_location.name if current_location is not None else None,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                detail="Сначала нужно прибыть в эту локацию, а потом уже идти к ее точкам интереса.",
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                scope="poi",
            )
        local_modes = _local_modes(payload)
        resolved_mode_id, resolved_mode_label, resolved_modes = _select_travel_mode(travel_mode, local_modes)
        if current_poi is not None and current_poi.id == destination_poi.id:
            return StoryMapTravelPreviewOut(
                reachable=True,
                destination_location_id=destination.location_id,
                destination_name=destination.name,
                destination_poi_id=destination_poi.id,
                destination_poi_name=destination_poi.name,
                destination_label=destination_poi.name,
                from_location_id=current_location.id,
                from_location_name=current_location.name,
                from_poi_id=current_poi.id,
                from_poi_name=current_poi.name,
                route_ids=[],
                route_steps=[],
                base_travel_minutes=0,
                adjusted_travel_minutes=0,
                weather_multiplier=weather_multiplier,
                environment_time_enabled=environment_time_enabled,
                travel_mode=resolved_mode_id,
                travel_mode_label=resolved_mode_label,
                available_modes=resolved_modes,
                distance_km=0.0,
                arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=0),
                detail="Эта точка уже активна.",
                scope="poi",
            )
        start_x, start_y = _current_anchor(payload, current_location, current_poi)
        base_travel_minutes = max(int(round(legacy_story_map._story_map_distance(start_x, start_y, destination_poi.x, destination_poi.y) * 0.18)), 3)
        adjusted_travel_minutes = int(round(_apply_local_mode_minutes(base_travel_minutes, resolved_mode_id) * weather_multiplier))
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.location_id,
            destination_name=destination.name,
            destination_poi_id=destination_poi.id,
            destination_poi_name=destination_poi.name,
            destination_label=destination_poi.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            from_poi_id=current_poi.id if current_poi is not None else None,
            from_poi_name=current_poi.name if current_poi is not None else "",
            route_ids=[],
            route_steps=[],
            base_travel_minutes=base_travel_minutes,
            adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            travel_mode=resolved_mode_id,
            travel_mode_label=resolved_mode_label,
            available_modes=resolved_modes,
            distance_km=_minutes_to_km(base_travel_minutes),
            arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=adjusted_travel_minutes),
            detail="Маршрут внутри локации построен.",
            scope="poi",
        )

    if destination is None:
        return StoryMapTravelPreviewOut(
            reachable=False,
            destination_location_id=normalized_destination_location_id or "",
            destination_label=legacy_story_map._normalize_text(destination_label, max_length=160),
            detail="Точка назначения не найдена на карте.",
            environment_time_enabled=environment_time_enabled,
        )

    if current_location is None:
        route_modes = _route_modes_for_path(payload, [])
        resolved_mode_id, resolved_mode_label, resolved_modes = _select_travel_mode(travel_mode, route_modes)
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.id,
            destination_name=destination.name,
            destination_label=destination.name,
            from_location_id=None,
            from_location_name=None,
            route_ids=[],
            route_steps=[],
            base_travel_minutes=0,
            adjusted_travel_minutes=0,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            travel_mode=resolved_mode_id,
            travel_mode_label=resolved_mode_label,
            available_modes=resolved_modes,
            distance_km=0.0,
            arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=0),
            detail="Текущая позиция не определена, выбранная локация станет новой опорной точкой.",
            scope="location",
        )

    if current_location.id == destination.id:
        local_modes = _local_modes(payload)
        resolved_mode_id, resolved_mode_label, resolved_modes = _select_travel_mode(travel_mode, local_modes)
        start_x, start_y = _current_anchor(payload, current_location, current_poi)
        distance_to_center = legacy_story_map._story_map_distance(start_x, start_y, destination.x, destination.y)
        if distance_to_center > 2:
            base_travel_minutes = max(int(round(distance_to_center * 0.18)), 2)
            adjusted_travel_minutes = int(round(_apply_local_mode_minutes(base_travel_minutes, resolved_mode_id) * weather_multiplier))
            return StoryMapTravelPreviewOut(
                reachable=True,
                destination_location_id=destination.id,
                destination_name=destination.name,
                destination_label=destination.name,
                from_location_id=current_location.id,
                from_location_name=current_location.name,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                route_ids=[],
                route_steps=[],
                base_travel_minutes=base_travel_minutes,
                adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
                weather_multiplier=weather_multiplier,
                environment_time_enabled=environment_time_enabled,
                travel_mode=resolved_mode_id,
                travel_mode_label=resolved_mode_label,
                available_modes=resolved_modes,
                distance_km=max(round(distance_to_center * 0.03, 1), 0.1),
                arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=adjusted_travel_minutes),
                detail="Возвращаемся к опорной точке текущей локации.",
                scope="location",
            )
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.id,
            destination_name=destination.name,
            destination_label=destination.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            route_ids=[],
            route_steps=[],
            base_travel_minutes=0,
            adjusted_travel_minutes=0,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            travel_mode=resolved_mode_id,
            travel_mode_label=resolved_mode_label,
            available_modes=resolved_modes,
            distance_km=0.0,
            arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=0),
            detail="Вы уже находитесь в этой локации.",
            scope="location",
        )

    route_path = legacy_story_map._shortest_route_path(payload, from_location_id=current_location.id, to_location_id=destination.id)
    if route_path is None:
        return StoryMapTravelPreviewOut(
            reachable=False,
            destination_location_id=destination.id,
            destination_name=destination.name,
            destination_label=destination.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Маршрут к выбранной точке сейчас не построен.",
            scope="location",
        )

    route_modes = _route_modes_for_path(payload, route_path)
    resolved_mode_id, resolved_mode_label, resolved_modes = _select_travel_mode(travel_mode, route_modes)
    base_travel_minutes = sum(max(int(route.travel_minutes or 0), 0) for route in route_path)
    adjusted_by_mode = _apply_route_mode_minutes(route_path, resolved_mode_id)
    if adjusted_by_mode is None:
        return StoryMapTravelPreviewOut(
            reachable=False,
            destination_location_id=destination.id,
            destination_name=destination.name,
            destination_label=destination.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Для этого маршрута выбранный способ перемещения не подходит.",
            scope="location",
        )
    adjusted_travel_minutes = int(round(adjusted_by_mode * weather_multiplier))
    return StoryMapTravelPreviewOut(
        reachable=True,
        destination_location_id=destination.id,
        destination_name=destination.name,
        destination_label=destination.name,
        from_location_id=current_location.id,
        from_location_name=current_location.name,
        route_ids=[route.id for route in route_path],
        route_steps=_route_steps(route_path, location_by_id),
        base_travel_minutes=base_travel_minutes,
        adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
        weather_multiplier=weather_multiplier,
        environment_time_enabled=environment_time_enabled,
        travel_mode=resolved_mode_id,
        travel_mode_label=resolved_mode_label,
        available_modes=resolved_modes,
        distance_km=_minutes_to_km(base_travel_minutes),
        arrival_datetime=_estimate_arrival_datetime(game, travel_minutes=adjusted_travel_minutes),
        detail=_route_detail(route_path, destination.name),
        scope="location",
    )


def _upsert_travel_log_entry(
    payload: StoryMapStateOut,
    *,
    assistant_message_id: int | None,
    from_location_id: str,
    from_location_name: str,
    to_location_id: str,
    to_location_name: str,
    route_ids: list[str],
    travel_minutes: int,
    weather_multiplier: float,
    travel_mode: str,
    travel_mode_label: str,
    distance_km: float,
    summary: str,
) -> list[dict[str, Any]]:
    entries = [entry.model_dump(mode="python") for entry in payload.travel_log]
    if isinstance(assistant_message_id, int) and assistant_message_id > 0:
        entries = [entry for entry in entries if int(entry.get("assistant_message_id") or 0) != assistant_message_id]
    entries.append(
        {
            "assistant_message_id": assistant_message_id,
            "from_location_id": from_location_id,
            "to_location_id": to_location_id,
            "route_ids": route_ids,
            "travel_minutes": max(int(travel_minutes), 0),
            "weather_multiplier": round(max(float(weather_multiplier), 1.0), 2),
            "travel_mode": legacy_story_map._normalize_text(travel_mode, max_length=32),
            "travel_mode_label": legacy_story_map._normalize_text(travel_mode_label, max_length=80),
            "distance_km": round(max(float(distance_km), 0.0), 1),
            "arrived_at": legacy_story_map._utcnow_iso(),
            "summary": legacy_story_map._normalize_text(summary, max_length=240) or f"{from_location_name or from_location_id} -> {to_location_name or to_location_id}",
        }
    )
    return entries[-legacy_story_map.STORY_MAP_MAX_TRAVEL_LOG :]


def travel_story_map_to_location(
    *,
    game: StoryGame,
    destination_location_id: str,
    destination_poi_id: str | None = None,
    travel_mode: str | None = None,
    destination_x: float | None = None,
    destination_y: float | None = None,
    destination_label: str | None = None,
) -> StoryMapStateOut:
    payload = get_story_map_state_or_400(game)
    preview = build_story_map_travel_preview(
        game=game,
        payload=payload,
        destination_location_id=destination_location_id,
        destination_poi_id=destination_poi_id,
        travel_mode=travel_mode,
        destination_x=destination_x,
        destination_y=destination_y,
        destination_label=destination_label,
    )
    if not preview.reachable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=preview.detail or "Destination is unreachable")

    location_by_id = legacy_story_map._location_candidates_from_payload(payload)
    destination = location_by_id.get(preview.destination_location_id)
    if destination is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Destination was not found on the map")

    poi_by_id = legacy_story_map._story_map_poi_by_id(payload)
    current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
    current_poi = poi_by_id.get(payload.current_poi_id or "") if payload.current_poi_id else None

    if preview.adjusted_travel_minutes > 0:
        legacy_story_map._advance_environment_datetime_for_travel(game, travel_minutes=preview.adjusted_travel_minutes)

    start_label = payload.current_anchor_label or preview.from_poi_name or preview.from_location_name or destination.name
    end_label = preview.destination_label or preview.destination_poi_name or preview.destination_name or destination.name
    should_log = (
        preview.adjusted_travel_minutes > 0
        or preview.scope in {"poi", "waypoint"}
        or (preview.from_location_id or "") != preview.destination_location_id
    )
    if should_log:
        from_location_name = (
            preview.from_location_name
            or (current_location.name if current_location is not None else destination.name)
        )
        payload.travel_log = [
            StoryMapTravelLogEntryOut.model_validate(entry)
            for entry in _upsert_travel_log_entry(
                payload,
                assistant_message_id=None,
                from_location_id=preview.from_location_id or destination.id,
                from_location_name=from_location_name,
                to_location_id=preview.destination_location_id,
                to_location_name=preview.destination_name or destination.name,
                route_ids=preview.route_ids,
                travel_minutes=preview.adjusted_travel_minutes,
                weather_multiplier=preview.weather_multiplier,
                travel_mode=preview.travel_mode,
                travel_mode_label=preview.travel_mode_label,
                distance_km=preview.distance_km,
                summary=f"{start_label} -> {end_label}",
            )
        ]

    payload.current_location_id = destination.id
    payload.current_region_id = destination.region_id
    payload.current_location_label = destination.name
    payload.last_sync_warning = ""

    if preview.scope == "poi":
        payload.current_poi_id = preview.destination_poi_id or None
        payload.current_poi_label = preview.destination_poi_name or preview.destination_label
        destination_poi = poi_by_id.get(preview.destination_poi_id or "")
        if destination_poi is not None:
            _set_anchor_from_poi(payload, destination_poi)
        else:
            _set_anchor_from_location(payload, destination)
    elif preview.scope == "waypoint":
        payload.current_poi_id = None
        payload.current_poi_label = ""
        resolved_x = float(destination_x) if destination_x is not None else (payload.current_anchor_x or destination.x)
        resolved_y = float(destination_y) if destination_y is not None else (payload.current_anchor_y or destination.y)
        _set_anchor_from_waypoint(
            payload,
            x=resolved_x,
            y=resolved_y,
            label=preview.destination_label or destination_label or destination.name,
        )
    else:
        payload.current_poi_id = None
        payload.current_poi_label = ""
        _set_anchor_from_location(payload, destination)

    payload.updated_at = legacy_story_map._utcnow_iso()
    game.story_map_enabled = True
    game.story_map_payload = payload.model_dump_json()
    touch_story_game(game)
    return payload


def sync_story_map_after_assistant_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage | None = None,
    latest_user_prompt: str | None = None,
    latest_assistant_text: str | None = None,
    current_location_content: str | None = None,
) -> bool:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled:
        return False

    resolved_latest_user_prompt = legacy_story_map._normalize_multiline_text(latest_user_prompt, max_length=1200)
    resolved_latest_assistant_text = legacy_story_map._normalize_multiline_text(latest_assistant_text, max_length=2400)
    resolved_location_content = legacy_story_map._normalize_multiline_text(
        current_location_content or legacy_story_map._latest_location_memory_content(db, game_id=game.id),
        max_length=320,
    )

    matched_location = legacy_story_map._match_location_from_text(payload, resolved_location_content)
    if matched_location is None and resolved_latest_assistant_text:
        matched_location = legacy_story_map._match_location_from_text(payload, resolved_latest_assistant_text)
    if matched_location is None and resolved_latest_user_prompt:
        matched_location = legacy_story_map._match_location_from_text(payload, resolved_latest_user_prompt)

    poi_location_id = matched_location.id if matched_location is not None else (payload.current_location_id or None)
    matched_poi = legacy_story_map._match_poi_from_text(payload, resolved_location_content, location_id=poi_location_id)
    if matched_poi is None and resolved_latest_assistant_text:
        matched_poi = legacy_story_map._match_poi_from_text(payload, resolved_latest_assistant_text, location_id=poi_location_id)
    if matched_poi is None and resolved_latest_user_prompt:
        matched_poi = legacy_story_map._match_poi_from_text(payload, resolved_latest_user_prompt, location_id=poi_location_id)

    changed = False
    next_overlay_mode = (
        legacy_story_map.STORY_MAP_OVERLAY_POLITICAL
        if legacy_story_map._should_show_political_overlay(
            latest_user_prompt=resolved_latest_user_prompt,
            latest_assistant_text=resolved_latest_assistant_text,
        )
        else payload.overlay_mode
    )
    if next_overlay_mode != payload.overlay_mode:
        payload.overlay_mode = next_overlay_mode
        changed = True

    if matched_location is not None:
        previous_location_id = payload.current_location_id or ""
        next_location_id = matched_location.id
        if next_location_id != previous_location_id:
            route_path = legacy_story_map._shortest_route_path(payload, from_location_id=previous_location_id, to_location_id=next_location_id) if previous_location_id else []
            if route_path is None and previous_location_id:
                next_warning = f"Переход {previous_location_id} -> {next_location_id} выпал вне дорожной сети."[:240]
                if payload.last_sync_warning != next_warning:
                    payload.last_sync_warning = next_warning
                    changed = True
            else:
                payload.last_sync_warning = ""
                base_travel_minutes = sum(max(int(route.travel_minutes or 0), 0) for route in route_path or [])
                weather_multiplier = legacy_story_map._weather_multiplier_for_game(game)
                route_modes = _route_modes_for_path(payload, route_path or [])
                resolved_mode_id, resolved_mode_label, _ = _select_travel_mode(None, route_modes)
                adjusted_mode_minutes = _apply_route_mode_minutes(route_path or [], resolved_mode_id)
                adjusted_travel_minutes = int(
                    round(
                        (
                            adjusted_mode_minutes
                            if adjusted_mode_minutes is not None
                            else base_travel_minutes
                        )
                        * weather_multiplier
                    )
                )
                location_candidates = legacy_story_map._location_candidates_from_payload(payload)
                from_location = location_candidates.get(previous_location_id or next_location_id)
                if adjusted_travel_minutes > 0:
                    legacy_story_map._advance_environment_datetime_for_travel(game, travel_minutes=adjusted_travel_minutes)
                payload.travel_log = [
                    StoryMapTravelLogEntryOut.model_validate(entry)
                    for entry in _upsert_travel_log_entry(
                        payload,
                        assistant_message_id=int(assistant_message.id) if isinstance(assistant_message, StoryMessage) else None,
                        from_location_id=previous_location_id or next_location_id,
                        from_location_name=from_location.name if from_location is not None else (previous_location_id or next_location_id),
                        to_location_id=next_location_id,
                        to_location_name=matched_location.name,
                        route_ids=[route.id for route in route_path or []],
                        travel_minutes=adjusted_travel_minutes,
                        weather_multiplier=weather_multiplier,
                        travel_mode=resolved_mode_id,
                        travel_mode_label=resolved_mode_label,
                        distance_km=_minutes_to_km(base_travel_minutes),
                        summary=f"{from_location.name if from_location is not None else previous_location_id or next_location_id} -> {matched_location.name}",
                    )
                ]
                payload.current_location_id = next_location_id
                payload.current_location_label = matched_location.name
                payload.current_region_id = matched_location.region_id
                payload.current_poi_id = None
                payload.current_poi_label = ""
                _set_anchor_from_location(payload, matched_location)
                changed = True
        else:
            if payload.last_sync_warning:
                payload.last_sync_warning = ""
                changed = True
            if payload.current_location_label != matched_location.name:
                payload.current_location_label = matched_location.name
                changed = True
            if payload.current_region_id != matched_location.region_id:
                payload.current_region_id = matched_location.region_id
                changed = True
    elif payload.last_sync_warning:
        payload.last_sync_warning = ""
        changed = True

    if matched_poi is not None:
        if payload.current_poi_id != matched_poi.id:
            payload.current_poi_id = matched_poi.id
            changed = True
        if payload.current_poi_label != matched_poi.name:
            payload.current_poi_label = matched_poi.name
            changed = True
        if payload.current_anchor_scope != "poi" or payload.current_anchor_x != matched_poi.x or payload.current_anchor_y != matched_poi.y or payload.current_anchor_label != matched_poi.name:
            _set_anchor_from_poi(payload, matched_poi)
            changed = True
    elif matched_location is not None:
        if payload.current_poi_id is not None:
            payload.current_poi_id = None
            changed = True
        if payload.current_poi_label:
            payload.current_poi_label = ""
            changed = True
        if payload.current_anchor_scope == "poi":
            _set_anchor_from_location(payload, matched_location)
            changed = True

    if changed:
        payload.updated_at = legacy_story_map._utcnow_iso()
        game.story_map_enabled = True
        game.story_map_payload = payload.model_dump_json()
    return changed


def build_story_map_prompt_card(game: StoryGame) -> dict[str, str] | None:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled or not payload.locations:
        return None

    location_by_id = legacy_story_map._location_candidates_from_payload(payload)
    region_by_id = {region.id: region for region in payload.regions}
    poi_by_id = legacy_story_map._story_map_poi_by_id(payload)
    current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
    current_region = region_by_id.get(current_location.region_id or "") if current_location is not None else None
    current_poi = poi_by_id.get(payload.current_poi_id or "") if payload.current_poi_id else None
    nearby_pois = legacy_story_map._story_map_focus_pois_for_location(payload, location_id=current_location.id if current_location is not None else None, limit=8)

    if payload.current_anchor_scope == "poi" and current_poi is not None:
        current_anchor_text = f"{current_poi.name} (точка интереса)"
    elif payload.current_anchor_scope == "waypoint" and payload.current_anchor_label:
        current_anchor_text = f"{payload.current_anchor_label} (свободная точка внутри локации)"
    elif current_location is not None:
        current_anchor_text = f"{current_location.name} (опорная точка локации)"
    else:
        current_anchor_text = payload.current_anchor_label or "не уточнена"

    adjacent_route_lines: list[str] = []
    for route in payload.routes:
        if current_location is None:
            break
        if route.from_location_id != current_location.id and route.to_location_id != current_location.id:
            continue
        other_location_id = route.to_location_id if route.from_location_id == current_location.id else route.from_location_id
        other_location = location_by_id.get(other_location_id)
        if other_location is None:
            continue
        adjacent_route_lines.append(f"- {other_location.name}: {legacy_story_map._route_label_ru(route.kind)}, ~{max(int(route.travel_minutes or 0), 0)} мин.")
    if not adjacent_route_lines:
        adjacent_route_lines.append("- Из текущей точки нет разрешенного прямого выхода без сцены дороги.")

    nearby_poi_lines = [
        f"- {poi.name}: {legacy_story_map.STORY_MAP_POI_KIND_LABELS_RU.get(poi.kind, poi.kind)}."
        for poi in nearby_pois
    ] or ["- Внутренние точки локации пока не выделены."]

    region_lines = [f"- {region.name}: {legacy_story_map.STORY_MAP_REGION_KIND_LABELS_RU.get(region.kind, 'регион')}." for region in payload.regions[:4]]
    location_lines = [
        f"- {location.name}: {legacy_story_map.STORY_MAP_LOCATION_KIND_LABELS_RU.get(location.kind, location.kind)}."
        for location in sorted(payload.locations, key=lambda item: int(item.importance or 0), reverse=True)[:16]
    ]
    mode_lines = [f"- {item['label']}: {item['description']}" for item in _theme_travel_mode_catalog(payload.theme)[:5]]

    content_lines = [
        f"Current map theme: {payload.theme}.",
        f"Current world start anchor: {payload.start_location}.",
        f"Current player location on map: {current_location.name if current_location is not None else payload.current_location_label or 'unknown'}.",
        f"Current precise local anchor: {current_anchor_text}.",
        f"Тема мира: {payload.theme}.",
        f"Стартовая локация карты: {payload.start_location}.",
        f"Текущая позиция героя: {current_location.name if current_location is not None else payload.current_location_label or 'неизвестна'}.",
        f"Текущий регион: {current_region.name if current_region is not None else 'не уточнен'}.",
        f"Текущая внутренняя опорная точка: {current_anchor_text}.",
        "ПРАВИЛО КАРТЫ: герой не должен мгновенно переноситься в известный город, регион или POI без маршрута, цепочки маршрутов, оправданного транспорта или явной сцены дороги.",
        "Если игрок перемещается внутри текущей локации, можно использовать свободные точки внутри нее, но не выходить за логические пределы места без отдельного перехода.",
        "Если игрок спрашивает про границы, столицы, тракт, порт, рынок, замок или другие опорные точки, опирайся на уже существующую карту и не придумывай новую географию без причины.",
        "Доступные способы перемещения для сеттинга:",
        *mode_lines,
        "Доступные маршруты из текущей точки:",
        *adjacent_route_lines[:8],
        "Точки интереса внутри текущей локации:",
        *nearby_poi_lines[:8],
        "Главные регионы карты:",
        *region_lines,
        "Известные крупные локации:",
        *location_lines,
    ]
    return {
        "title": "Карта мира: навигация и масштаб",
        "content": "\n".join(line for line in content_lines if line).strip(),
    }
