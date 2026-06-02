import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetType, loadAssetBundle } from '@arkntools/unity-js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const ENV_PATH = path.join(ROOT, '.env');

const SLOT_COLORS: Record<number, string> = {
  1: 'white',
  2: 'blue',
  3: 'orange',
};

const RARITIES: Record<number, string> = {
  0: 'common',
  1: 'rare',
  2: 'legendary',
};

const UNIT_TYPES: Record<number, string> = {
  1: 'attack',
  2: 'support',
  3: 'both',
};

type CsvRow = Record<string, string>;

type UnityAssetObject = {
  type: AssetType;
  name: string;
  pathId: bigint;
  data?: ArrayBuffer;
  className?: string;
  script?: {
    pathId: bigint;
  };
  getRaw?: () => ArrayBuffer;
};

type UnityAssetFile = {
  objects: UnityAssetObject[];
};

type CellLayout = {
  cell: number;
  x: number;
  y: number;
  lane: number;
  column: number;
};

type ShipLayout = {
  columns: number;
  lanes: number;
  cells: CellLayout[];
  starting_units: Record<string, unknown>[];
};

type ShipBinding = {
  kind: 'player' | 'enemy';
  ship: string;
};

function loadEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value.replace(/\\n/g, '\n');
  }
  return result;
}

function requireGameDataDir(env: Record<string, string>): string {
  const configured = env.LONESTAR_GAME_DIR || env.GAME_DIR;
  if (!configured) {
    throw new Error('Set LONESTAR_GAME_DIR in .env to the Lonestar game folder.');
  }

  const resolved = path.resolve(ROOT, configured);
  const dataDir = path.basename(resolved) === 'LONESTAR_Data' ? resolved : path.join(resolved, 'LONESTAR_Data');
  if (!existsSync(path.join(dataDir, 'resources.assets'))) {
    throw new Error(`Unable to find resources.assets in ${dataDir}`);
  }
  return dataDir;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  return dataRows.map(values =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
}

async function loadAssets(filePath: string): Promise<UnityAssetFile> {
  return (await loadAssetBundle(readFileSync(filePath))) as UnityAssetFile;
}

function bufferFromArrayBuffer(data: ArrayBuffer): Buffer {
  return Buffer.from(data);
}

function isTextAsset(obj: UnityAssetObject): obj is UnityAssetObject & { data: ArrayBuffer } {
  return obj.type === AssetType.TextAsset && !!obj.data;
}

function isMonoBehaviour(obj: UnityAssetObject): obj is UnityAssetObject & { script: { pathId: bigint }; getRaw: () => ArrayBuffer } {
  return obj.type === AssetType.MonoBehaviour && !!obj.script && !!obj.getRaw;
}

function isMonoScript(obj: UnityAssetObject): obj is UnityAssetObject & { className?: string } {
  return obj.type === AssetType.MonoScript;
}

async function textAsset(assetPath: string, name: string): Promise<string> {
  const env = await loadAssets(assetPath);
  for (const obj of env.objects) {
    if (!isTextAsset(obj) || obj.name !== name) continue;
    return bufferFromArrayBuffer(obj.data).toString('utf8').replace(/^\uFEFF/, '');
  }
  throw new Error(`TextAsset not found: ${name}`);
}

function parseIntList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => Number.parseInt(part, 10));
}

function parseTextMap(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(';"')) continue;
    const [key, rest = ''] = line.split(';"', 2);
    result[key] = rest.replace(/"$/, '').replace(/\\n/g, '\n');
  }
  return result;
}

async function loadCsvAsset(resourcesPath: string, name: string): Promise<CsvRow[]> {
  const rows = parseCsv(await textAsset(resourcesPath, name));
  return rows.slice(1).filter(row => /^\d+$/.test(row.ID || ''));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function localize(key: string, fallback: string, texts: Record<string, string>): string {
  return key && texts[key] ? texts[key] : fallback || '';
}

function intOrNone(value: string): number | null {
  return value ? Number.parseInt(value, 10) : null;
}

function slots(powerSlot: string): string[] {
  return parseIntList(powerSlot).map(color => SLOT_COLORS[color] || `unknown_${color}`);
}

function parseBool(value: string): boolean | null {
  if (!value) return null;
  return value.trim().toLowerCase() === 'true';
}

async function scriptNameMap(globalGameManagersPath: string): Promise<Map<bigint, string>> {
  const result = new Map<bigint, string>();
  const env = await loadAssets(globalGameManagersPath);
  for (const obj of env.objects) {
    if (isMonoScript(obj)) {
      result.set(obj.pathId, obj.className || obj.name);
    }
  }
  return result;
}

function readInt32LE(raw: Buffer, offset: number): number {
  if (offset + 4 > raw.length) throw new RangeError(`Unable to read int32 at ${offset}`);
  return raw.readInt32LE(offset);
}

function monoNameDataOffset(raw: Buffer): number {
  const nameLength = readInt32LE(raw, 28);
  let offset = 32 + nameLength;
  if (offset % 4) offset += 4 - (offset % 4);
  return offset;
}

function parseShipAssetLayout(rawData: ArrayBuffer): ShipLayout | null {
  const raw = bufferFromArrayBuffer(rawData);
  const offset = monoNameDataOffset(raw);
  const ints: number[] = [];
  for (let cursor = offset; cursor + 4 <= raw.length; cursor += 4) {
    ints.push(raw.readInt32LE(cursor));
  }
  if (ints.length < 6) return null;

  const columns = ints[0];
  const lanes = ints[1];
  const cellCount = ints[4];
  const coordStart = 5;
  const coordEnd = coordStart + cellCount * 2;
  if (coordEnd >= ints.length) return null;

  const cells: CellLayout[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const x = ints[coordStart + index * 2];
    const y = ints[coordStart + index * 2 + 1];
    cells.push({
      cell: index + 1,
      x,
      y,
      lane: lanes - y,
      column: x + 1,
    });
  }

  const shipCellAssetCountIndex = coordEnd;
  const shipCellAssetCount = ints[shipCellAssetCountIndex];
  const shipCellAssetStart = shipCellAssetCountIndex + 1;
  const startingUnits: Record<string, unknown>[] = [];

  for (let index = 0; index < shipCellAssetCount; index += 1) {
    const base = shipCellAssetStart + index * 3;
    if (base + 2 >= ints.length) break;

    const unitId = ints[base];
    const level = ints[base + 1];
    const shadowDir = ints[base + 2];
    if (unitId <= 0) continue;

    const cell = cells[index] || ({ cell: index + 1 } as Partial<CellLayout>);
    startingUnits.push({
      unit_id: unitId,
      level,
      cell: cell.cell,
      lane: cell.lane,
      column: cell.column,
      x: cell.x,
      y: cell.y,
      shadow_dir: shadowDir,
    });
  }

  return {
    columns,
    lanes,
    cells,
    starting_units: startingUnits,
  };
}

async function shipAssetLayouts(
  resourcesPath: string,
  globalGameManagersPath: string,
  scriptType: string,
): Promise<Record<string, ShipLayout>> {
  const scripts = await scriptNameMap(globalGameManagersPath);
  const result: Record<string, ShipLayout> = {};
  const env = await loadAssets(resourcesPath);

  for (const obj of env.objects) {
    if (!isMonoBehaviour(obj)) continue;
    try {
      if (scripts.get(obj.script.pathId) !== scriptType) continue;
      const layout = parseShipAssetLayout(obj.getRaw());
      if (layout) result[obj.name] = layout;
    } catch {
      continue;
    }
  }
  return result;
}

function buildPlayerShipMap(shipRows: CsvRow[], shipTexts: Record<string, string>): Record<number, string> {
  const result: Record<number, string> = {};
  for (const row of shipRows) {
    const name = localize(row.Name, row.Name_, shipTexts);
    result[Number.parseInt(row.ID, 10)] = slug(name);
  }
  return result;
}

function buildShips(
  shipUnitRows: CsvRow[],
  playerShipMap: Record<number, string>,
  enemyRows: CsvRow[],
  enemyTexts: Record<string, string>,
): Record<number, ShipBinding[]> {
  const belongs = new Map<number, Map<string, ShipBinding>>();
  const setBinding = (unitId: number, key: string, binding: ShipBinding) => {
    if (!belongs.has(unitId)) belongs.set(unitId, new Map());
    belongs.get(unitId)!.set(key, binding);
  };

  for (const row of shipUnitRows) {
    const unitId = Number.parseInt(row.ID, 10);
    for (const shipId of parseIntList(row.Pros)) {
      if (playerShipMap[shipId]) {
        const ship = playerShipMap[shipId];
        setBinding(unitId, `player:${ship}`, { kind: 'player', ship });
      }
    }
  }

  for (const row of enemyRows) {
    const enemyName = slug(localize(row.Name, row.Name_, enemyTexts));
    for (const suffix of ['', '_1', '_2', '_3']) {
      for (const unitId of parseIntList(row[`KeyUnitIDs${suffix}`])) {
        setBinding(unitId, `enemy:${enemyName}`, { kind: 'enemy', ship: enemyName });
      }
    }
  }

  return Object.fromEntries(
    Array.from(belongs.entries()).map(([unitId, items]) => [unitId, Array.from(items.values())]),
  );
}

function cleanPlayerShip(
  row: CsvRow,
  shipTexts: Record<string, string>,
  playerShipLayouts: Record<string, ShipLayout>,
): Record<string, unknown> {
  const name = localize(row.Name, row.Name_, shipTexts);
  const description = localize(row.Des, row.Des_, shipTexts);
  const assetName = path.basename(row.ShipDataPath);
  const layout = playerShipLayouts[assetName];
  return {
    id: Number.parseInt(row.ID, 10),
    key: slug(name),
    kind: 'player',
    name,
    description,
    hp: intOrNone(row.HP),
    unlock_level: intOrNone(row.UnlockLV),
    skill: row.ShipSkill,
    args: parseIntList(row.Args),
    move: intOrNone(row.Move),
    lanes: layout?.lanes,
    columns: layout?.columns,
    starting_units: layout?.starting_units || [],
    cells: layout?.cells || [],
    ship_data_path: row.ShipDataPath,
    power_core_weight: parseIntList(row.PowerCoreWeight),
    power_color_weight: parseIntList(row.PowerColorWeight),
    bounty_events: parseIntList(row.BountyEvents),
    mod_path: row.ModPath,
    vacation_ship_image: row.VacationShipImage,
    move_path: row.MovePath,
    in_game: parseBool(row.InGame),
    image: row.Image,
    button_icon: row.ButtonIcon,
    shadow_sprite: row.ShadowSprite,
    raw: {
      talent_result_slot: row.TalentResultSlot,
    },
  };
}

function enemyPhaseUnits(row: CsvRow, suffix: string): Record<string, number | null>[] {
  const ids = parseIntList(row[`KeyUnitIDs${suffix}`]);
  const levels = parseIntList(row[`KeyUnitLVs${suffix}`]);
  return ids.map((unitId, index) => ({
    unit_id: unitId,
    level: levels[index] ?? null,
  }));
}

function cleanEnemyShip(row: CsvRow, enemyTexts: Record<string, string>): Record<string, unknown> {
  const name = localize(row.Name, row.Name_, enemyTexts);
  const pilotName = localize(row.PilotName, row.PilotName_, enemyTexts);
  const description = localize(row.Des, row.Des_, enemyTexts);
  const phaseSuffixes = ['', '_1', '_2', '_3'];
  return {
    id: Number.parseInt(row.ID, 10),
    key: slug(name),
    kind: 'enemy',
    name,
    pilot_name: pilotName,
    description,
    image: row.Image,
    unlock_level: intOrNone(row.UnlockLV),
    hp_by_phase: ['HP', 'HP_1'].filter(field => row[field]).map(field => Number.parseInt(row[field], 10)),
    break_count_by_phase: ['BreakCount', 'BreakCount_1']
      .filter(field => row[field])
      .map(field => Number.parseInt(row[field], 10)),
    background_path: row.BackgroundPath,
    ship_data_paths: phaseSuffixes
      .map(suffix => row[`ShipDataPath${suffix}`] || '')
      .filter(Boolean),
    key_units_by_phase: phaseSuffixes
      .map((suffix, index) => ({ phase: index, units: enemyPhaseUnits(row, suffix) }))
      .filter(phase => phase.units.length),
    mod_path: row.ModPath,
    in_game: parseBool(row.InGame),
    only_pro: parseIntList(row.OnlyPro),
    start_yell: localize(row.StartYell, row.StartYell_, enemyTexts),
    end_yell: localize(row.EndYell, row.EndYell_, enemyTexts),
    win_yell: localize(row.WinYell, row.WinYell_, enemyTexts),
    raw: {
      enemy_type: intOrNone(row.EnemyType),
      enemy_phase_type: intOrNone(row.EnemyPhaseType),
    },
  };
}

function normalizedSkillName(row: CsvRow, texts: Record<string, string>): string {
  const skillName = localize(row.SkillName, row.SkillName_, texts);
  return skillName === 'Empty' ? '' : skillName;
}

function unitInvariants(row: CsvRow, texts: Record<string, string>): Record<string, unknown> {
  return {
    skill_name: normalizedSkillName(row, texts),
    rarity: row.Rare ? RARITIES[Number.parseInt(row.Rare, 10)] || row.Rare : null,
    type: row.Type ? UNIT_TYPES[Number.parseInt(row.Type, 10)] || row.Type : null,
    unlock_level: intOrNone(row.UnlockLV),
    gain_type: intOrNone(row.GainType),
    count_offset: intOrNone(row.CountOffset),
    weight_offset: intOrNone(row.WeightOffset),
    skill_path: row.SkillPath,
  };
}

function cleanLevel(row: CsvRow, texts: Record<string, string>): Record<string, unknown> {
  const args = parseIntList(row.Args);
  const description = localize(row.Description, row.Description_, texts);
  const extraDescription = localize(row.ExtraDes, row.ExtraDes_, texts);

  return {
    level: Number.parseInt(row.Lv, 10),
    name: localize(row.Name, row.Name_, texts),
    slots: slots(row.PowerSlot),
    effect: description,
    extra_effect: extraDescription,
    args,
    weight: intOrNone(row.EquiptLimit),
    sprite_path: row.SpritePath,
    mod_path: row.ModPath,
    raw: {
      properties: row.Propertys,
    },
  };
}

function assertUnitInvariants(
  unitId: number,
  rowsForUnit: CsvRow[],
  texts: Record<string, string>,
): Record<string, unknown> {
  const expected = unitInvariants(rowsForUnit[0], texts);
  for (const row of rowsForUnit.slice(1)) {
    const actual = unitInvariants(row, texts);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Refusing lossy refactor: invariant fields vary for unit ${unitId}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`,
      );
    }
  }
  return expected;
}

async function main() {
  const env: Record<string, string> = loadEnv(ENV_PATH);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const dataDir = requireGameDataDir(env);
  const resourcesPath = path.join(dataDir, 'resources.assets');
  const sharedPath = path.join(dataDir, 'sharedassets0.assets');
  const globalGameManagersPath = path.join(dataDir, 'globalgamemanagers.assets');
  const outPath = path.resolve(ROOT, env.LONESTAR_DATA_OUT || 'public/lonestar_data.json');

  const texts = parseTextMap(await textAsset(sharedPath, 'EnglishTextMap_Unit'));
  const shipTexts = parseTextMap(await textAsset(sharedPath, 'EnglishTextMap_Ship'));
  const enemyTexts = parseTextMap(await textAsset(sharedPath, 'EnglishTextMap_EnemyShip'));
  const playerShipLayouts = await shipAssetLayouts(resourcesPath, globalGameManagersPath, 'PlayerShipAsset');

  const rows = await loadCsvAsset(resourcesPath, 'ShipUnit');
  const shipRows = (await loadCsvAsset(resourcesPath, 'Ship')).filter(row => parseBool(row.InGame) !== false);
  const enemyRows = (await loadCsvAsset(resourcesPath, 'EnemyShip')).filter(row => parseBool(row.InGame) !== false);
  const playerShipMap = buildPlayerShipMap(shipRows, shipTexts);
  const ships = buildShips(rows, playerShipMap, enemyRows, enemyTexts);

  const rowsByUnit = new Map<number, CsvRow[]>();
  for (const row of rows) {
    const unitId = Number.parseInt(row.ID, 10);
    rowsByUnit.set(unitId, [...(rowsByUnit.get(unitId) || []), row]);
  }

  const units = Array.from(rowsByUnit.keys())
    .sort((left, right) => left - right)
    .map(unitId => {
      const unitRows = rowsByUnit.get(unitId)!.sort((left, right) => Number.parseInt(left.Lv, 10) - Number.parseInt(right.Lv, 10));
      return {
        id: unitId,
        ships: ships[unitId] || [],
        ...assertUnitInvariants(unitId, unitRows, texts),
        levels: unitRows.map(row => cleanLevel(row, texts)),
      };
    });

  const output = {
    source: {
      unit_table: 'LONESTAR_Data/resources.assets:TextAsset ShipUnit',
      player_ship_table: 'LONESTAR_Data/resources.assets:TextAsset Ship',
      enemy_ship_table: 'LONESTAR_Data/resources.assets:TextAsset EnemyShip',
      localization: 'LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_Unit',
      ship_localization: 'LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_Ship',
      enemy_ship_localization: 'LONESTAR_Data/sharedassets0.assets:TextAsset EnglishTextMap_EnemyShip',
      player_ship_bindings: 'LONESTAR_Data/resources.assets:TextAsset ShipUnit Pros -> Ship IDs',
      enemy_ship_bindings: 'LONESTAR_Data/resources.assets:TextAsset EnemyShip KeyUnitIDs',
    },
    notes: [
      'The ShipUnit table has no literal static Strength column. Dynamic Strength changes are in effect.',
      'slots is an ordered list of lowercase slot color ids.',
      'ships includes player ships from ShipUnit.Pros and enemy ships from EnemyShip.KeyUnitIDs.',
    ],
    ships: {
      players: shipRows.map(row => cleanPlayerShip(row, shipTexts, playerShipLayouts)),
      enemies: enemyRows.map(row => cleanEnemyShip(row, enemyTexts)),
    },
    units,
  };

  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath} (${units.length} units, ${rows.length} level rows)`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
