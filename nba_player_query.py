#!/usr/bin/env python3
"""Query and rank the NBA player data used by the Hupu 82-0 game.

The script reads the downloaded `nba-data.js`, reconstructs the game's player
rating formula, and exposes a small CLI for sorting and filtering players.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEFAULT_DATA_FILE = (
    Path(__file__).resolve().parent
    / "fetched_activity_project_ai_1781070826571"
    / "nba-data.js"
)

ERA_BENCHMARKS: dict[str, dict[str, float]] = {
    "1960s": {"pts": 30, "reb": 18, "ast": 8, "stl": 1.8, "blk": 1.8},
    "1970s": {"pts": 28, "reb": 13, "ast": 9, "stl": 2, "blk": 2},
    "1980s": {"pts": 28, "reb": 11, "ast": 11, "stl": 2.2, "blk": 2},
    "1990s": {"pts": 27, "reb": 11, "ast": 9, "stl": 2, "blk": 2},
    "2000s": {"pts": 27, "reb": 11, "ast": 9, "stl": 2, "blk": 2},
    "2010s": {"pts": 28, "reb": 11, "ast": 9, "stl": 1.8, "blk": 1.8},
    "2020s": {"pts": 28, "reb": 11, "ast": 9, "stl": 1.8, "blk": 1.8},
}

POSITION_WEIGHTS: dict[str, dict[str, float]] = {
    "PG": {"pts": 0.4, "reb": 0.1, "ast": 0.35, "stl": 0.1, "blk": 0.05},
    "SG": {"pts": 0.45, "reb": 0.1, "ast": 0.2, "stl": 0.2, "blk": 0.05},
    "SF": {"pts": 0.45, "reb": 0.15, "ast": 0.2, "stl": 0.15, "blk": 0.05},
    "PF": {"pts": 0.4, "reb": 0.3, "ast": 0.1, "stl": 0.1, "blk": 0.1},
    "C": {"pts": 0.4, "reb": 0.35, "ast": 0.1, "stl": 0.05, "blk": 0.1},
}

STAT_KEYS = ("pts", "reb", "ast", "stl", "blk")

INTANGIBLES = {
    "larry bird",
    "tim duncan",
    "kevin durant",
    "magic johnson",
    "shaquille o'neal",
    "hakeem olajuwon",
    "bill russell",
    "kobe bryant",
    "oscar robertson",
    "karl malone",
    "kevin garnett",
    "isiah thomas",
    "tony parker",
    "manu ginobili",
    "draymond green",
    "scottie pippen",
    "dennis rodman",
    "stephen curry",
    "nikola jokic",
    "dirk nowitzki",
}


@dataclass(frozen=True)
class Player:
    team: str
    player: str
    cname: str
    pos: str
    positions: tuple[str, ...]
    era: str
    base_slug: str
    player_id: str
    pts: float | None
    reb: float | None
    ast: float | None
    stl: float | None
    blk: float | None
    rating: float
    detail: dict[str, Any]

    @property
    def display_name(self) -> str:
        return self.cname or self.player

    @property
    def total(self) -> float:
        return sum(v or 0 for v in (self.pts, self.reb, self.ast))

    @property
    def search_text(self) -> str:
        return " ".join(
            [
                self.display_name,
                self.player,
                self.cname,
                self.base_slug,
                self.player_id,
                self.team,
                self.era,
                self.pos,
                *self.positions,
            ]
        ).casefold()


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and not math.isnan(value)


def fmt_num(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.2f}".rstrip("0").rstrip(".")


def extract_raw_players(data_file: Path) -> list[dict[str, Any]]:
    text = data_file.read_text(encoding="utf-8")
    match = re.search(r"const\s+NBA_DATA_RAW\s*=\s*(\[.*\]);\s*$", text, re.S)
    if not match:
        raise ValueError(f"Cannot find NBA_DATA_RAW in {data_file}")
    return json.loads(match.group(1))


def calculate_rating_detail(raw: dict[str, Any]) -> dict[str, Any]:
    era = raw.get("era") or "2020s"
    bench = ERA_BENCHMARKS.get(era, ERA_BENCHMARKS["2020s"])
    positions = raw.get("positions") or ()
    base_key = positions[0] if positions else raw.get("pos") or "SF"
    weights = dict(POSITION_WEIGHTS.get(base_key, POSITION_WEIGHTS["SF"]))
    original_weights = dict(weights)

    stats = {
        "pts": raw.get("ppg"),
        "reb": raw.get("rpg"),
        "ast": raw.get("apg"),
        "stl": raw.get("spg"),
        "blk": raw.get("bpg"),
    }

    missing = [key for key in ("stl", "blk") if not is_number(stats[key])]
    if missing:
        kept_weight = sum(weights[key] for key in STAT_KEYS if key not in missing)
        scale = 1 / kept_weight if kept_weight > 0 else 1
        for key in ("pts", "reb", "ast"):
            weights[key] *= scale
        for key in missing:
            weights[key] = 0

    normalized = 0.0
    ratios: dict[str, float | None] = {}
    stat_scores: dict[str, float] = {}
    for key in STAT_KEYS:
        value = stats[key]
        if not is_number(value):
            ratios[key] = None
            stat_scores[key] = 0.0
            continue
        ratio = float(value) / bench[key]
        if ratio > 1:
            ratio = ratio**1.25
        ratios[key] = ratio
        normalized += weights[key] * ratio
        stat_scores[key] = 40 * weights[key] * ratio

    base = 60 + 40 * normalized
    versatility = max(len(positions) - 1, 0) * 3
    # The page stores only `name: cname || player` after loading raw data, so
    # the INTANGIBLES lookup is effectively against the display name at runtime.
    display_name = raw.get("cname") or raw.get("player") or ""
    intangible = 2.5 if str(display_name).casefold() in INTANGIBLES else 0
    raw_rating = base + versatility + intangible
    rating = min(100.0, round(raw_rating * 10) / 10)
    return {
        "rating": rating,
        "raw_rating": raw_rating,
        "base_position": base_key,
        "original_weights": original_weights,
        "weights": weights,
        "bench": bench,
        "ratios": ratios,
        "stat_scores": stat_scores,
        "normalized": normalized,
        "base": base,
        "versatility": versatility,
        "intangible": intangible,
        "missing_stats": missing,
    }


def player_rating(raw: dict[str, Any]) -> float:
    return float(calculate_rating_detail(raw)["rating"])


def build_players(raw_players: Iterable[dict[str, Any]]) -> list[Player]:
    players: list[Player] = []
    for raw in raw_players:
        detail = calculate_rating_detail(raw)
        players.append(
            Player(
                team=raw.get("team") or "",
                player=raw.get("player") or "",
                cname=raw.get("cname") or raw.get("player") or "",
                pos=raw.get("pos") or "",
                positions=tuple(raw.get("positions") or ()),
                era=raw.get("era") or "",
                base_slug=raw.get("baseSlug") or "",
                player_id=raw.get("id") or "",
                pts=raw.get("ppg"),
                reb=raw.get("rpg"),
                ast=raw.get("apg"),
                stl=raw.get("spg"),
                blk=raw.get("bpg"),
                rating=float(detail["rating"]),
                detail=detail,
            )
        )
    return players


def filter_players(players: Iterable[Player], args: argparse.Namespace) -> list[Player]:
    result = list(players)
    if not args.include_1950s:
        result = [p for p in result if p.era != "1950s"]
    if args.name:
        needle = args.name.casefold()
        result = [p for p in result if needle in p.search_text]
    if args.team:
        teams = {team.strip().upper() for team in args.team.split(",") if team.strip()}
        result = [p for p in result if p.team.upper() in teams]
    if args.decade:
        decades = {decade.strip() for decade in args.decade.split(",") if decade.strip()}
        result = [p for p in result if p.era in decades]
    if args.position:
        positions = {pos.strip().upper() for pos in args.position.split(",") if pos.strip()}
        result = [p for p in result if positions.intersection(p.positions) or p.pos.upper() in positions]
    if args.min_rating is not None:
        result = [p for p in result if p.rating >= args.min_rating]
    return result


def sort_players(players: list[Player], sort_key: str, reverse: bool) -> list[Player]:
    key_map = {
        "rating": lambda p: (p.rating, p.total, p.pts or 0, p.display_name),
        "total": lambda p: (p.total, p.rating, p.pts or 0, p.display_name),
        "pts": lambda p: (p.pts or 0, p.rating, p.total, p.display_name),
        "reb": lambda p: (p.reb or 0, p.rating, p.total, p.display_name),
        "ast": lambda p: (p.ast or 0, p.rating, p.total, p.display_name),
        "stl": lambda p: (p.stl or 0, p.rating, p.total, p.display_name),
        "blk": lambda p: (p.blk or 0, p.rating, p.total, p.display_name),
        "name": lambda p: p.display_name,
    }
    return sorted(players, key=key_map[sort_key], reverse=reverse)


def player_to_row(rank: int, player: Player) -> dict[str, str | int | float]:
    return {
        "rank": rank,
        "rating": player.rating,
        "total": round(player.total, 2),
        "name": player.display_name,
        "english": player.player,
        "team": player.team,
        "era": player.era,
        "pos": player.pos,
        "positions": "/".join(player.positions),
        "pts": fmt_num(player.pts),
        "reb": fmt_num(player.reb),
        "ast": fmt_num(player.ast),
        "stl": fmt_num(player.stl),
        "blk": fmt_num(player.blk),
        "id": player.player_id,
    }


def player_to_detail_row(rank: int, player: Player) -> dict[str, str | int | float]:
    detail = player.detail
    stat_scores = detail["stat_scores"]
    ratios = detail["ratios"]
    weights = detail["weights"]
    return {
        **player_to_row(rank, player),
        "base_pos": detail["base_position"],
        "normalized": round(detail["normalized"], 4),
        "base_score": round(detail["base"], 2),
        "raw_rating": round(detail["raw_rating"], 2),
        "versatility": round(detail["versatility"], 2),
        "intangible": round(detail["intangible"], 2),
        "pts_ratio": "-" if ratios["pts"] is None else round(ratios["pts"], 4),
        "reb_ratio": "-" if ratios["reb"] is None else round(ratios["reb"], 4),
        "ast_ratio": "-" if ratios["ast"] is None else round(ratios["ast"], 4),
        "stl_ratio": "-" if ratios["stl"] is None else round(ratios["stl"], 4),
        "blk_ratio": "-" if ratios["blk"] is None else round(ratios["blk"], 4),
        "pts_weight": round(weights["pts"], 4),
        "reb_weight": round(weights["reb"], 4),
        "ast_weight": round(weights["ast"], 4),
        "stl_weight": round(weights["stl"], 4),
        "blk_weight": round(weights["blk"], 4),
        "pts_score": round(stat_scores["pts"], 2),
        "reb_score": round(stat_scores["reb"], 2),
        "ast_score": round(stat_scores["ast"], 2),
        "stl_score": round(stat_scores["stl"], 2),
        "blk_score": round(stat_scores["blk"], 2),
        "missing_stats": "/".join(detail["missing_stats"]) or "-",
    }


def print_rows(rows: list[dict[str, Any]], columns: list[str], headers: dict[str, str]) -> None:
    if not rows:
        print("没有找到匹配的球员")
        return
    widths = {
        col: max(len(headers[col]), *(len(str(row[col])) for row in rows))
        for col in columns
    }

    def line(values: dict[str, Any]) -> str:
        return "  ".join(str(values[col]).ljust(widths[col]) for col in columns)

    print(line(headers))
    print("  ".join("-" * widths[col] for col in columns))
    for row in rows:
        print(line(row))


def print_table(players: list[Player], limit: int) -> None:
    rows = [player_to_row(rank, player) for rank, player in enumerate(players[:limit], start=1)]
    columns = ["rank", "rating", "total", "name", "english", "team", "era", "positions", "pts", "reb", "ast", "stl", "blk"]
    headers = {
        "rank": "#",
        "rating": "评分",
        "total": "三项和",
        "name": "姓名",
        "english": "英文名",
        "team": "队",
        "era": "年代",
        "positions": "位置",
        "pts": "PTS",
        "reb": "REB",
        "ast": "AST",
        "stl": "STL",
        "blk": "BLK",
    }
    print_rows(rows, columns, headers)


def print_detail_table(players: list[Player], limit: int) -> None:
    rows = [player_to_detail_row(rank, player) for rank, player in enumerate(players[:limit], start=1)]
    columns = [
        "rank",
        "rating",
        "raw_rating",
        "name",
        "english",
        "team",
        "era",
        "positions",
        "base_pos",
        "base_score",
        "pts_score",
        "reb_score",
        "ast_score",
        "stl_score",
        "blk_score",
        "versatility",
        "intangible",
        "missing_stats",
    ]
    headers = {
        "rank": "#",
        "rating": "封顶评分",
        "raw_rating": "原始评分",
        "name": "姓名",
        "english": "英文名",
        "team": "队",
        "era": "年代",
        "positions": "位置",
        "base_pos": "计权位置",
        "base_score": "基础分",
        "pts_score": "PTS贡献",
        "reb_score": "REB贡献",
        "ast_score": "AST贡献",
        "stl_score": "STL贡献",
        "blk_score": "BLK贡献",
        "versatility": "多位置",
        "intangible": "无形",
        "missing_stats": "缺失项",
    }
    print_rows(rows, columns, headers)


def output_rows(players: list[Player], limit: int, details: bool) -> list[dict[str, str | int | float]]:
    row_builder = player_to_detail_row if details else player_to_row
    return [row_builder(rank, player) for rank, player in enumerate(players[:limit], start=1)]


def write_csv(players: list[Player], limit: int, output: Path, details: bool) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = output_rows(players, limit, details)
    with output.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=list(rows[0].keys()) if rows else [])
        if rows:
            writer.writeheader()
            writer.writerows(rows)


def summarize(players: list[Player]) -> None:
    eras = sorted({p.era for p in players})
    teams = sorted({p.team for p in players})
    positions = sorted({pos for p in players for pos in p.positions})
    print(f"球员记录: {len(players)}")
    print(f"年代: {', '.join(eras)}")
    print(f"球队数: {len(teams)}")
    print(f"位置: {', '.join(positions)}")
    print(f"评分100: {sum(1 for p in players if p.rating == 100)}")
    print(f"评分>=95: {sum(1 for p in players if p.rating >= 95)}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="梳理并查询虎扑 82-0 游戏的 NBA 球员数据，默认按游戏评分从高到低排列。"
    )
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_FILE, help=f"nba-data.js 路径，默认: {DEFAULT_DATA_FILE}")
    parser.add_argument("--name", help="按姓名/英文名/id/baseSlug 模糊查询，例如: 詹姆斯、Jordan、lebron")
    parser.add_argument("--team", help="按球队缩写过滤，可逗号分隔，例如: LAL,CHI")
    parser.add_argument("--decade", help="按年代过滤，可逗号分隔，例如: 1990s,2000s")
    parser.add_argument("--position", help="按可打位置过滤，可逗号分隔，例如: PG,SF")
    parser.add_argument("--min-rating", type=float, help="最低游戏评分")
    parser.add_argument("--include-1950s", action="store_true", help="包含网页抽签时排除的 1950s 数据")
    parser.add_argument("--sort", choices=("rating", "total", "pts", "reb", "ast", "stl", "blk", "name"), default="rating")
    parser.add_argument("--asc", action="store_true", help="升序排列，默认降序")
    parser.add_argument("--top", type=int, help="输出前 N 条；普通查询默认 30，球队年代明细默认全部")
    parser.add_argument("--details", action="store_true", help="输出评分明细，适合配合 --team 和 --decade 查看某年代球队各球员")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--csv", type=Path, help="导出 CSV 到指定路径")
    parser.add_argument("--summary", action="store_true", help="输出数据摘要")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    raw_players = extract_raw_players(args.data)
    players = build_players(raw_players)
    filtered = filter_players(players, args)
    sorted_players = sort_players(filtered, args.sort, reverse=not args.asc)

    if args.summary:
        summarize(sorted_players)
        if not sorted_players:
            return 0
        print()

    if args.top is None:
        limit = len(sorted_players) if args.details and args.team and args.decade else 30
    else:
        limit = max(args.top, 0)
    if args.csv:
        write_csv(sorted_players, limit, args.csv, args.details)
        print(f"已导出 {min(limit, len(sorted_players))} 条记录到 {args.csv}")
        return 0

    if args.json:
        rows = output_rows(sorted_players, limit, args.details)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    if args.details:
        print_detail_table(sorted_players, limit)
        return 0

    print_table(sorted_players, limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
