// 官方定价表与费用计算（DeepSeek，2026-09-10 12:00 北京时间起生效）。
// - 高峰价 = 空闲价 × 2。
// - 高峰 = UTC 周一~五 01:00-04:00 与 06:00-10:00（其余全部为闲时，含整个周末）。
// - 单位：元 / 百万 tokens。

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

export interface ModelPrice {
  cache_hit: number; // 输入缓存命中
  cache_miss: number; // 输入未命中
  output: number;
}

export const PRICING: Record<string, ModelPrice> = {
  "deepseek-v4-flash": { cache_hit: 0.02, cache_miss: 1, output: 4 },
  "deepseek-v4-pro": { cache_hit: 0.15, cache_miss: 4.5, output: 13.5 },
  "deepseek-v4-flash-vision-exp": { cache_hit: 0.02, cache_miss: 1, output: 4 },
};

export const DEFAULT_MODEL = "deepseek-v4-flash";

export type PriceOverrides = Record<string, Partial<ModelPrice>>;

// 生效定价表：默认官方价 + 用户配置覆盖（扩展/代理启动时 setPricingTable 注入）
let activeTable: Record<string, ModelPrice> = PRICING;

/** 默认表合并用户覆盖，得到完整生效表。 */
export function applyOverrides(
  overrides?: PriceOverrides,
): Record<string, ModelPrice> {
  const t: Record<string, ModelPrice> = { ...PRICING };
  for (const [m, o] of Object.entries(overrides ?? {})) {
    t[m] = { ...(t[m] ?? t[DEFAULT_MODEL]), ...o };
  }
  return t;
}

export function setPricingTable(table: Record<string, ModelPrice>): void {
  activeTable = table;
}

export function resetPricingTable(): void {
  activeTable = PRICING;
}

/** 取某模型生效价（缺失回退默认模型）。 */
export function modelPrice(model: string): ModelPrice {
  return activeTable[model] ?? activeTable[DEFAULT_MODEL];
}

// 北京时间用 dayjs 的 UTC 模式偏移表示（字段即北京值，不受宿主时区影响）
const bj = (ts: Date | string | number): dayjs.Dayjs =>
  dayjs.utc(ts).add(8, "hour");

// --- 高峰时段：以 UTC 绝对时刻为唯一事实来源 -----------------------------
// 官方（api-docs.deepseek.com/quick_start/pricing）：高峰 = UTC 周一~五
// 01:00-04:00 与 06:00-10:00，其余时间（含整个周末）一律闲时。
// 判断基于 UTC，因此与运行 VS Code 的机器时区无关，在任何时区都成立。
const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

/** 两个高峰窗口的「UTC 当日分钟数」起止，仅周一~五生效。 */
const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [
  [1 * 60, 4 * 60], // 01:00-04:00 UTC
  [6 * 60, 10 * 60], // 06:00-10:00 UTC
];

/** 该 UTC 时刻是否落在高峰窗口内（周一~五）。 */
function isPeakUtcMs(ms: number): boolean {
  const d = new Date(ms);
  const wd = d.getUTCDay(); // 0=周日 .. 6=周六
  if (wd === 0 || wd === 6) return false;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return PEAK_WINDOWS_UTC.some(([a, b]) => minutes >= a && minutes < b);
}

/** ms 所在那一周的周一 00:00 UTC。 */
function weekStartUtcMs(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS; // 周日=0 → 回退 6 天
}

/** 本周 + 下周所有的「高峰 ↔ 闲时」切换时刻（升序）。 */
function transitionsUtcMs(fromMs: number): number[] {
  const weekStart = weekStartUtcMs(fromMs);
  const out: number[] = [];
  for (let w = 0; w < 2; w++) {
    for (let d = 0; d < 5; d++) {
      const dayStart = weekStart + (w * 7 + d) * DAY_MS;
      for (const [a, b] of PEAK_WINDOWS_UTC) {
        out.push(dayStart + a * MIN_MS, dayStart + b * MIN_MS);
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/** tsUtc（Date 或 ISO 字符串）是否落在高峰时段（UTC 周一~五 01:00-04:00、06:00-10:00）。 */
export function isPeakBeijing(tsUtc: Date | string): boolean {
  const ms = typeof tsUtc === "string" ? Date.parse(tsUtc) : tsUtc.getTime();
  return Number.isFinite(ms) ? isPeakUtcMs(ms) : false;
}

export interface PeakState {
  /** 当前是否按高峰价（×2）计费。 */
  peak: boolean;
  /** 距离下一次「高峰 ↔ 闲时」切换的毫秒数。 */
  remainMs: number;
}

/** 当前计费状态 + 距离下次切换的倒计时。 */
export function peakStateAt(ts: Date | number = new Date()): PeakState {
  const now = typeof ts === "number" ? ts : ts.getTime();
  const next = transitionsUtcMs(now).find((f) => f > now);
  return {
    peak: isPeakUtcMs(now),
    remainMs: next === undefined ? 0 : Math.max(0, next - now),
  };
}

/** 两个高峰窗口在「本机时区」下的显示文本，如 ["21:00–00:00", "02:00–06:00"]。 */
export function peakWindowsLocal(): string[] {
  const ref = weekStartUtcMs(Date.now()); // 以本周一为参照，标签自动跟随夏令时
  const hhmm = (ms: number): string => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return PEAK_WINDOWS_UTC.map(
    ([a, b]) => `${hhmm(ref + a * MIN_MS)}–${hhmm(ref + b * MIN_MS)}`,
  );
}

export interface PeakSegment {
  peak: boolean;
  range: string; // 北京时间当前计费段，如 "09:00-12:00"
}

/** 北京时间当前所处计费段：高峰=周一~五 9-12、14-18，其余闲时。 */
export function currentBeijingSegment(tsUtc: Date | string): PeakSegment {
  const bt = bj(tsUtc);
  const wd = bt.day();
  const hm = bt.hour() + bt.minute() / 60;
  if (wd === 0 || wd === 6) return { peak: false, range: "00:00-24:00" };
  if (hm >= 9 && hm < 12) return { peak: true, range: "09:00-12:00" };
  if (hm >= 12 && hm < 14) return { peak: false, range: "12:00-14:00" };
  if (hm >= 14 && hm < 18) return { peak: true, range: "14:00-18:00" };
  if (hm >= 18) return { peak: false, range: "18:00-24:00" };
  // 凌晨属于跨夜闲时段：前一天 18:00 开始，至今早 09:00
  return { peak: false, range: "18:00-09:00" };
}

/** 精确 usage 计费；peak=True 按高峰价 ×2。返回本次请求费用（元）。 */
export function costFromUsage(
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number,
  cacheMissTokens: number,
  model = DEFAULT_MODEL,
  peak = false,
): number {
  const p = modelPrice(model);
  const f = peak ? 2.0 : 1.0;
  return (
    (cacheMissTokens * p.cache_miss +
      cacheHitTokens * p.cache_hit +
      completionTokens * p.output) /
      1e6 *
    f
  );
}
