#!/usr/bin/env python3
"""FastAPI frontend for the Hupu NBA 82-0 player query tool."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from nba_player_query import (
    DEFAULT_DATA_FILE,
    Player,
    build_players,
    extract_raw_players,
    filter_players,
    output_rows,
    player_to_detail_row,
    sort_players,
)


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "web" / "static"
POS_ORDER = ("PG", "SG", "SF", "PF", "C")

TEAM_GRADE_BANDS = [
    {"min": 80, "grade": "S", "label": "完美赛季", "color": "#d7b85a"},
    {"min": 72, "grade": "A+", "label": "历史级强队", "color": "#42b883"},
    {"min": 62, "grade": "A", "label": "王朝球队", "color": "#42b883"},
    {"min": 57, "grade": "B", "label": "有力竞争者", "color": "#5d8dee"},
    {"min": 50, "grade": "C", "label": "季后赛球队", "color": "#f0a331"},
    {"min": 40, "grade": "D", "label": "乐透球队", "color": "#87909c"},
    {"min": 0, "grade": "F", "label": "摆烂大军", "color": "#e85d75"},
]


class LineupRequest(BaseModel):
    slots: dict[str, str] = Field(default_factory=dict)


def make_app(data_file: Path = DEFAULT_DATA_FILE) -> FastAPI:
    raw_players = extract_raw_players(data_file)
    players = build_players(raw_players)
    by_id = {player.player_id: player for player in players}

    app = FastAPI(title="Hupu NBA 82-0 Lab")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/meta")
    def meta() -> dict[str, Any]:
        playable = [player for player in players if player.era != "1950s"]
        decades = sorted({player.era for player in players})
        teams = sorted({player.team for player in players if player.team})
        positions = list(POS_ORDER)
        teams_by_decade = {
            decade: sorted({player.team for player in players if player.era == decade and player.team})
            for decade in decades
        }
        return {
            "total": len(players),
            "playable_total": len(playable),
            "decades": decades,
            "playable_decades": [d for d in decades if d != "1950s"],
            "teams": teams,
            "positions": positions,
            "teams_by_decade": teams_by_decade,
            "rating_100": sum(1 for player in playable if player.rating == 100),
            "rating_95": sum(1 for player in playable if player.rating >= 95),
            "grade_bands": TEAM_GRADE_BANDS,
        }

    @app.get("/api/players")
    def api_players(
        name: str | None = None,
        team: str | None = None,
        decade: str | None = None,
        position: str | None = None,
        min_rating: float | None = None,
        include_1950s: bool = False,
        sort: str = Query("rating", pattern="^(rating|total|pts|reb|ast|stl|blk|name)$"),
        order: str = Query("desc", pattern="^(asc|desc)$"),
        details: bool = False,
        limit: int = Query(50, ge=0, le=500),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        args = argparse.Namespace(
            include_1950s=include_1950s,
            name=name,
            team=team,
            decade=decade,
            position=position,
            min_rating=min_rating,
        )
        filtered = filter_players(players, args)
        sorted_rows = sort_players(filtered, sort, reverse=order != "asc")
        page = sorted_rows[offset : offset + limit]
        return {
            "total": len(sorted_rows),
            "limit": limit,
            "offset": offset,
            "rows": output_rows(page, len(page), details),
        }

    @app.get("/api/players/{player_id}")
    def api_player(player_id: str) -> dict[str, Any]:
        player = by_id.get(player_id)
        if not player:
            raise HTTPException(status_code=404, detail="player not found")
        return player_to_detail_row(1, player)

    @app.post("/api/simulate")
    def simulate_lineup(request: LineupRequest) -> dict[str, Any]:
        slots = {slot.upper(): player_id for slot, player_id in request.slots.items() if player_id}
        missing_slots = [slot for slot in POS_ORDER if slot not in slots]
        if missing_slots:
            raise HTTPException(status_code=400, detail=f"missing slots: {', '.join(missing_slots)}")
        extra_slots = sorted(set(slots) - set(POS_ORDER))
        if extra_slots:
            raise HTTPException(status_code=400, detail=f"unknown slots: {', '.join(extra_slots)}")
        if len(set(slots.values())) != len(slots):
            raise HTTPException(status_code=400, detail="duplicate player in lineup")

        lineup: list[tuple[str, Player]] = []
        for slot in POS_ORDER:
            player = by_id.get(slots[slot])
            if not player:
                raise HTTPException(status_code=404, detail=f"player not found for {slot}")
            if slot not in player.positions:
                raise HTTPException(status_code=400, detail=f"{player.display_name} cannot play {slot}")
            lineup.append((slot, player))

        ratings = [player.rating for _, player in lineup]
        product = math.prod(ratings)
        geo_mean = product ** (1 / len(ratings))
        team_ovr = round(geo_mean * 1.1, 1)
        wins = round(82 * (min(team_ovr / 110, 1) ** 2.2))
        losses = 82 - wins
        band = next(band for band in TEAM_GRADE_BANDS if wins >= band["min"])
        return {
            "ratings": ratings,
            "geo_mean": round(geo_mean, 4),
            "team_ovr": team_ovr,
            "wins": wins,
            "losses": losses,
            "record": f"{wins}-{losses}",
            "grade": band,
            "players": [
                {**player_to_detail_row(index, player), "assigned_slot": slot}
                for index, (slot, player) in enumerate(lineup, start=1)
            ],
        }

    return app


app = make_app()


def main() -> int:
    import uvicorn

    parser = argparse.ArgumentParser(description="启动 NBA 82-0 可视化查询和阵容模拟应用")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    uvicorn.run("web_app:app", host=args.host, port=args.port, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
