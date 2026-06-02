import csv
import io
import json
import re
import struct
from collections import defaultdict
from pathlib import Path

import UnityPy


ROOT = Path(__file__).resolve().parent
RESOURCES = ROOT / "LONESTAR_Data" / "resources.assets"
SHARED = ROOT / "LONESTAR_Data" / "sharedassets0.assets"
OUT = ROOT / "lonestar_data.json"

SLOT_COLORS = {
    1: "white",
    2: "blue",
    3: "orange",
}

RARITIES = {
    0: "common",
    1: "rare",
    2: "legendary",
}

UNIT_TYPES = {
    1: "attack",
    2: "support",
    3: "both",
}


def text_asset(path, name):
    env = UnityPy.load(str(path))
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        data = obj.read()
        if getattr(data, "m_Name", "") == name:
            script = data.m_Script
            return script if isinstance(script, str) else bytes(script).decode("utf-8-sig")
    raise KeyError(f"TextAsset not found: {name}")


def parse_int_list(value):
    if not value:
        return []
    return [int(part) for part in value.split(";") if part.strip()]


def parse_text_map(text):
    result = {}
    for line in text.splitlines():
        if ';"' not in line:
            continue
        key, value = line.split(';"', 1)
        result[key] = value.rsplit('"', 1)[0].replace("\\n", "\n")
    return result


def load_csv_asset(name):
    text = text_asset(RESOURCES, name)
    return [row for row in list(csv.DictReader(io.StringIO(text)))[1:] if row.get("ID", "").isdigit()]


def slug(value):
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_") or "unknown"


def localize(key, fallback, texts):
    if key and key in texts:
        return texts[key]
    return fallback or ""


def fill_args(template, args):
    values = parse_int_list(args)

    def repl(match):
        index = int(match.group(1))
        return str(values[index]) if index < len(values) else match.group(0)

    return re.sub(r"\{(\d+)\}", repl, template or "")


def int_or_none(value):
    return int(value) if value else None


def slots(power_slot):
    return [SLOT_COLORS.get(color, f"unknown_{color}") for color in parse_int_list(power_slot)]


def parse_bool(value):
    if not value:
        return None
    return value.strip().lower() == "true"


def script_name_map():
    result = {}
    for obj in UnityPy.load(str(ROOT / "LONESTAR_Data" / "globalgamemanagers.assets")).objects:
        if obj.type.name == "MonoScript":
            data = obj.read()
            result[obj.path_id] = getattr(data, "m_Name", "")
    return result


def mono_name_data_offset(raw):
    name_length = struct.unpack_from("<i", raw, 28)[0]
    offset = 32 + name_length
    if offset % 4:
        offset += 4 - offset % 4
    return offset


def parse_ship_asset_layout(raw):
    offset = mono_name_data_offset(raw)
    ints = [struct.unpack_from("<i", raw, cursor)[0] for cursor in range(offset, len(raw), 4)]
    if len(ints) < 6:
        return None

    columns = ints[0]
    lanes = ints[1]
    cell_count = ints[4]
    coord_start = 5
    coord_end = coord_start + cell_count * 2
    if coord_end >= len(ints):
        return None

    cells = []
    for index in range(cell_count):
        x = ints[coord_start + index * 2]
        y = ints[coord_start + index * 2 + 1]
        cells.append(
            {
                "cell": index + 1,
                "x": x,
                "y": y,
                "lane": lanes - y,
                "column": x + 1,
            }
        )

    ship_cell_asset_count_index = coord_end
    ship_cell_asset_count = ints[ship_cell_asset_count_index]
    ship_cell_asset_start = ship_cell_asset_count_index + 1
    starting_units = []
    for index in range(ship_cell_asset_count):
        base = ship_cell_asset_start + index * 3
        if base + 2 >= len(ints):
            break
        unit_id, level, shadow_dir = ints[base : base + 3]
        if unit_id <= 0:
            continue
        cell = cells[index] if index < len(cells) else {"cell": index + 1}
        starting_units.append(
            {
                "unit_id": unit_id,
                "level": level,
                "cell": cell.get("cell"),
                "lane": cell.get("lane"),
                "column": cell.get("column"),
                "x": cell.get("x"),
                "y": cell.get("y"),
                "shadow_dir": shadow_dir,
            }
        )

    return {
        "columns": columns,
        "lanes": lanes,
        "cells": cells,
        "starting_units": starting_units,
    }


def ship_asset_layouts(script_type):
    scripts = script_name_map()
    result = {}
    for obj in UnityPy.load(str(RESOURCES)).objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            data = obj.read(check_read=False)
            if scripts.get(data.m_Script.m_PathID) != script_type:
                continue
            layout = parse_ship_asset_layout(obj.get_raw_data())
            if layout:
                result[getattr(data, "m_Name", "")] = layout
        except Exception:
            continue
    return result


def build_player_ship_map(ship_rows, ship_texts):
    result = {}
    for row in ship_rows:
        name = localize(row["Name"], row["Name_"], ship_texts)
        result[int(row["ID"])] = slug(name)
    return result


def build_ships(ship_unit_rows, player_ship_map, enemy_rows, enemy_texts):
    belongs = defaultdict(dict)

    for row in ship_unit_rows:
        unit_id = int(row["ID"])
        for ship_id in parse_int_list(row["Pros"]):
            if ship_id in player_ship_map:
                key = f"player:{player_ship_map[ship_id]}"
                belongs[unit_id][key] = {"kind": "player", "ship": player_ship_map[ship_id]}

    for row in enemy_rows:
        enemy_name = slug(localize(row["Name"], row["Name_"], enemy_texts))
        for suffix in ("", "_1", "_2", "_3"):
            for unit_id in parse_int_list(row.get(f"KeyUnitIDs{suffix}", "")):
                key = f"enemy:{enemy_name}"
                belongs[unit_id][key] = {"kind": "enemy", "ship": enemy_name}

    return {unit_id: list(items.values()) for unit_id, items in belongs.items()}


def clean_player_ship(row, ship_texts):
    name = localize(row["Name"], row["Name_"], ship_texts)
    description = localize(row["Des"], row["Des_"], ship_texts)
    asset_name = Path(row["ShipDataPath"]).name
    layout = PLAYER_SHIP_LAYOUTS.get(asset_name, {})
    return {
        "id": int(row["ID"]),
        "key": slug(name),
        "kind": "player",
        "name": name,
        "description": description,
        "hp": int(row["HP"]) if row["HP"] else None,
        "unlock_level": int(row["UnlockLV"]) if row["UnlockLV"] else None,
        "skill": row["ShipSkill"],
        "args": parse_int_list(row["Args"]),
        "move": int(row["Move"]) if row["Move"] else None,
        "lanes": layout.get("lanes"),
        "columns": layout.get("columns"),
        "starting_units": layout.get("starting_units", []),
        "cells": layout.get("cells", []),
        "ship_data_path": row["ShipDataPath"],
        "power_core_weight": parse_int_list(row["PowerCoreWeight"]),
        "power_color_weight": parse_int_list(row["PowerColorWeight"]),
        "bounty_events": parse_int_list(row["BountyEvents"]),
        "mod_path": row["ModPath"],
        "vacation_ship_image": row["VacationShipImage"],
        "move_path": row["MovePath"],
        "in_game": parse_bool(row["InGame"]),
        "image": row["Image"],
        "button_icon": row["ButtonIcon"],
        "shadow_sprite": row["ShadowSprite"],
        "raw": {
            "talent_result_slot": row["TalentResultSlot"],
        },
    }


def enemy_phase_units(row, suffix):
    ids = parse_int_list(row.get(f"KeyUnitIDs{suffix}", ""))
    levels = parse_int_list(row.get(f"KeyUnitLVs{suffix}", ""))
    return [
        {"unit_id": unit_id, "level": levels[index] if index < len(levels) else None}
        for index, unit_id in enumerate(ids)
    ]


def clean_enemy_ship(row, enemy_texts):
    name = localize(row["Name"], row["Name_"], enemy_texts)
    pilot_name = localize(row["PilotName"], row["PilotName_"], enemy_texts)
    description = localize(row["Des"], row["Des_"], enemy_texts)
    phase_suffixes = ["", "_1", "_2", "_3"]
    return {
        "id": int(row["ID"]),
        "key": slug(name),
        "kind": "enemy",
        "name": name,
        "pilot_name": pilot_name,
        "description": description,
        "image": row["Image"],
        "unlock_level": int(row["UnlockLV"]) if row["UnlockLV"] else None,
        "hp_by_phase": [int(row[field]) for field in ("HP", "HP_1") if row.get(field)],
        "break_count_by_phase": [int(row[field]) for field in ("BreakCount", "BreakCount_1") if row.get(field)],
        "background_path": row["BackgroundPath"],
        "ship_data_paths": [row.get(f"ShipDataPath{suffix}", "") for suffix in phase_suffixes if row.get(f"ShipDataPath{suffix}", "")],
        "key_units_by_phase": [
            {"phase": index, "units": enemy_phase_units(row, suffix)}
            for index, suffix in enumerate(phase_suffixes)
            if enemy_phase_units(row, suffix)
        ],
        "mod_path": row["ModPath"],
        "in_game": parse_bool(row["InGame"]),
        "only_pro": parse_int_list(row["OnlyPro"]),
        "start_yell": localize(row["StartYell"], row["StartYell_"], enemy_texts),
        "end_yell": localize(row["EndYell"], row["EndYell_"], enemy_texts),
        "win_yell": localize(row["WinYell"], row["WinYell_"], enemy_texts),
        "raw": {
            "enemy_type": int_or_none(row["EnemyType"]),
            "enemy_phase_type": int_or_none(row["EnemyPhaseType"]),
        },
    }


def normalized_skill_name(row):
    skill_name = localize(row["SkillName"], row["SkillName_"], TEXTS)
    return "" if skill_name == "Empty" else skill_name


def unit_invariants(row):
    return {
        "skill_name": normalized_skill_name(row),
        "rarity": RARITIES.get(int(row["Rare"]), row["Rare"]) if row["Rare"] else None,
        "type": UNIT_TYPES.get(int(row["Type"]), row["Type"]) if row["Type"] else None,
        "unlock_level": int_or_none(row["UnlockLV"]),
        "gain_type": int_or_none(row["GainType"]),
        "count_offset": int_or_none(row["CountOffset"]),
        "weight_offset": int_or_none(row["WeightOffset"]),
        "skill_path": row["SkillPath"],
    }


def clean_level(row):
    lv = int(row["Lv"])
    args = parse_int_list(row["Args"])
    description = localize(row["Description"], row["Description_"], TEXTS)
    extra_description = localize(row["ExtraDes"], row["ExtraDes_"], TEXTS)

    return {
        "level": lv,
        "name": localize(row["Name"], row["Name_"], TEXTS),
        "slots": slots(row["PowerSlot"]),
        "effect": description,
        "extra_effect": extra_description,
        "args": args,
        "weight": int_or_none(row["EquiptLimit"]),
        "sprite_path": row["SpritePath"],
        "mod_path": row["ModPath"],
        "raw": {
            "properties": row["Propertys"],
        },
    }


def assert_unit_invariants(unit_id, rows_for_unit):
    expected = unit_invariants(rows_for_unit[0])
    for row in rows_for_unit[1:]:
        actual = unit_invariants(row)
        if actual != expected:
            raise ValueError(
                f"Refusing lossy refactor: invariant fields vary for unit {unit_id}: "
                f"{expected} != {actual}"
            )
    return expected


TEXTS = parse_text_map(text_asset(SHARED, "EnglishTextMap_Unit"))
SHIP_TEXTS = parse_text_map(text_asset(SHARED, "EnglishTextMap_Ship"))
ENEMY_TEXTS = parse_text_map(text_asset(SHARED, "EnglishTextMap_EnemyShip"))
PLAYER_SHIP_LAYOUTS = ship_asset_layouts("PlayerShipAsset")

rows = load_csv_asset("ShipUnit")
ship_rows = [row for row in load_csv_asset("Ship") if parse_bool(row["InGame"]) is not False]
enemy_rows = [row for row in load_csv_asset("EnemyShip") if parse_bool(row["InGame"]) is not False]
player_ship_map = build_player_ship_map(ship_rows, SHIP_TEXTS)
ships = build_ships(rows, player_ship_map, enemy_rows, ENEMY_TEXTS)

rows_by_unit = defaultdict(list)
for row in rows:
    rows_by_unit[int(row["ID"])].append(row)

units = []
for unit_id in sorted(rows_by_unit):
    unit_rows = sorted(rows_by_unit[unit_id], key=lambda item: int(item["Lv"]))
    unit = {
        "id": unit_id,
        "ships": ships.get(unit_id, []),
        **assert_unit_invariants(unit_id, unit_rows),
        "levels": [clean_level(row) for row in unit_rows],
    }
    units.append(unit)

player_ships = [clean_player_ship(row, SHIP_TEXTS) for row in ship_rows]
enemy_ships = [clean_enemy_ship(row, ENEMY_TEXTS) for row in enemy_rows]

output = {
    "source": {
        "unit_table": "LONESTAR_Data/resources.assets:TextAsset ShipUnit",
        "player_ship_table": "LONESTAR_Data/resources.assets:TextAsset Ship",
        "enemy_ship_table": "LONESTAR_Data/resources.assets:TextAsset EnemyShip",
        "localization": "LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_Unit",
        "ship_localization": "LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_Ship",
        "enemy_ship_localization": "LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_EnemyShip",
        "player_ship_bindings": "LONESTAR_Data/resources.assets:TextAsset ShipUnit Pros -> Ship IDs",
        "enemy_ship_bindings": "LONESTAR_Data/resources.assets:TextAsset EnemyShip KeyUnitIDs",
    },
    "notes": [
        "The ShipUnit table has no literal static Strength column. Dynamic Strength changes are in effect.",
        "slots is an ordered list of lowercase slot color ids.",
        "ships includes player ships from ShipUnit.Pros and enemy ships from EnemyShip.KeyUnitIDs.",
    ],
    "ships": {
        "players": player_ships,
        "enemies": enemy_ships,
    },
    "units": units,
}

OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {OUT} ({len(units)} units, {len(rows)} level rows)")
