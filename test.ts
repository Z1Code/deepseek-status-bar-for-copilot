// 单元测试：定价、区间窗口、聚合、图表数据、货币、JSONL、i18n。
// 运行：npm test
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isPeakBeijing,
  currentBeijingSegment,
  peakStateAt,
  costFromUsage,
  modelPrice,
  applyOverrides,
} from "./src/pricing";
import {
  beijingDayStartUtcMs,
  rangeWindow,
  allChartWindow,
  customRangeWindow,
  aggregateRange,
  aggregateCustom,
} from "./src/stats";
import { buildChartPayload, ChartKind } from "./src/chartData";
import { fmtMoney, moneyPair } from "./src/currency";
import { appendRecord, TailReader, UsageRecord } from "./src/jsonl";
import { t, isZh } from "./src/i18n";

let failures = 0;
const check = (name: string, got: unknown, exp: unknown) => {
  const ok = String(got) === String(exp);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} → ${String(got)} ${ok ? "" : `(期望 ${String(exp)})`}`);
};

// 北京时间（UTC+8）日历时刻 → UTC ISO 字符串
const BEO = 8 * 3600 * 1000;
const bjIso = (y: number, m: number, d: number, h: number, min = 0): string =>
  new Date(Date.UTC(y, m - 1, d, h, min) - BEO).toISOString();

// ---------- 1. 定价 ----------
{
  check("peak Tue 10:00", isPeakBeijing(bjIso(2026, 8, 25, 10)), true);
  check("peak Tue 09:00 边界", isPeakBeijing(bjIso(2026, 8, 25, 9, 0)), true);
  check("peak Tue 12:00 非峰", isPeakBeijing(bjIso(2026, 8, 25, 12)), false);
  check("peak Tue 14:00 边界", isPeakBeijing(bjIso(2026, 8, 25, 14)), true);
  check("peak Tue 18:00 非峰", isPeakBeijing(bjIso(2026, 8, 25, 18)), false);
  check("peak Sat 非峰", isPeakBeijing(bjIso(2026, 8, 29, 10)), false);
  check("peak Sun 非峰", isPeakBeijing(bjIso(2026, 8, 23, 10)), false);

  check("seg 10:00", currentBeijingSegment(bjIso(2026, 8, 25, 10)).range, "09:00-12:00");
  check("seg 13:00", currentBeijingSegment(bjIso(2026, 8, 25, 13)).range, "12:00-14:00");
  check("seg 16:00", currentBeijingSegment(bjIso(2026, 8, 25, 16)).range, "14:00-18:00");
  check("seg 21:00", currentBeijingSegment(bjIso(2026, 8, 25, 21)).range, "18:00-24:00");
  check("seg 04:00 跨夜", currentBeijingSegment(bjIso(2026, 8, 26, 4)).range, "18:00-09:00");
  check("seg Sat", currentBeijingSegment(bjIso(2026, 8, 29, 10)).range, "00:00-24:00");

  // flash（2026-09-10 起）：1M 未命中 + 1M 命中 + 1M 输出 = 1 + 0.02 + 4
  check("cost flash 非峰", costFromUsage(2e6, 1e6, 1e6, 1e6, "deepseek-v4-flash", false), 5.02);
  check("cost flash 峰 ×2", costFromUsage(2e6, 1e6, 1e6, 1e6, "deepseek-v4-flash", true), 10.04);
  // pro：1M 未命中 + 1M 输出
  check("cost pro 非峰", costFromUsage(1e6, 1e6, 0, 1e6, "deepseek-v4-pro", false), 18);
  check("modelPrice 未知回退", modelPrice("nope").cache_hit, 0.02);
  const ov = applyOverrides({ "deepseek-v4-flash": { cache_hit: 9 } });
  check("applyOverrides 覆盖", ov["deepseek-v4-flash"].cache_hit, 9);
  check("applyOverrides 其余保留", ov["deepseek-v4-pro"].cache_hit, 0.15);
}

// ---------- 1b. 计费段倒计时（UTC 绝对时刻） ----------
{
  const MIN = 60_000;
  const st = (iso: string) => peakStateAt(Date.parse(iso));
  // 高峰窗口 = UTC 周一~五 01:00-04:00、06:00-10:00
  check("st Tue 00:30 闲时", st("2026-08-25T00:30:00Z").peak, false);
  check("st Tue 00:30 距高峰 30m", st("2026-08-25T00:30:00Z").remainMs / MIN, 30);
  check("st Tue 02:00 高峰", st("2026-08-25T02:00:00Z").peak, true);
  check("st Tue 02:00 距闲时 120m", st("2026-08-25T02:00:00Z").remainMs / MIN, 120);
  check("st Tue 04:30 距高峰 90m", st("2026-08-25T04:30:00Z").remainMs / MIN, 90);
  check("st Tue 11:00 距次日高峰 14h", st("2026-08-25T11:00:00Z").remainMs / MIN, 14 * 60);
  // 周五 10:00 后直到周一 01:00 都是闲时 → 62 小时
  check("st Fri 11:00 距周一 62h", st("2026-08-28T11:00:00Z").remainMs / MIN, 62 * 60);
  check("st Sat 全天闲时", st("2026-08-29T02:00:00Z").peak, false);
  check("st Sat 距周一 47h", st("2026-08-29T02:00:00Z").remainMs / MIN, 47 * 60);
}

// ---------- 2. 区间窗口 ----------
{
  const now = new Date(bjIso(2026, 8, 27, 12)); // Thu 12:00 北京
  const DAY = 86400000;
  const tw = rangeWindow("today", now);
  check("today start 北京零点", tw.start, Date.parse("2026-08-26T16:00:00.000Z"));
  check("today end", tw.end - tw.start, DAY);
  const ww = rangeWindow("week", now);
  check("week start 周一", ww.start, Date.parse("2026-08-23T16:00:00.000Z"));
  check("week span 7天", ww.end - ww.start, 7 * DAY);
  const mw = rangeWindow("month", now);
  check("month start 8/1", mw.start, Date.parse("2026-07-31T16:00:00.000Z"));
  check("month end 9/1", mw.end, Date.parse("2026-08-31T16:00:00.000Z"));
  check("beijingDayStart", beijingDayStartUtcMs(now), tw.start);
  const cw = customRangeWindow("2026-08-27", "week");
  check("custom week start", cw.start, ww.start);
  const cm = customRangeWindow("2026-08-27", "month");
  check("custom month start", cm.start, mw.start);
  const cd = customRangeWindow("2026-08-27", "day");
  check("custom day span", cd.end - cd.start, DAY);
  // allChartWindow：最早记录北京日 → 今天北京日结束
  const earliest = { ts: bjIso(2026, 8, 20, 5), model: "m", prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cache_hit_tokens: 0, cache_miss_tokens: 0, stream: true, status: 200 };
  const aw = allChartWindow([earliest], now);
  check("allChart start 最早北京日", aw.start, Date.parse("2026-08-19T16:00:00.000Z"));
  check("allChart end 今天末", aw.end, tw.end);
}

// ---------- 3. 聚合 ----------
{
  const now = new Date(bjIso(2026, 8, 27, 12));
  const rec = (ts: string, extra: Partial<UsageRecord> = {}): UsageRecord => ({
    ts, model: "deepseek-v4-flash", prompt_tokens: 1e6, completion_tokens: 0,
    total_tokens: 1e6, cache_hit_tokens: 0, cache_miss_tokens: 1e6,
    stream: true, status: 200, ...extra,
  });
  const r1 = rec(bjIso(2026, 8, 27, 10), { ms: 1000 }); // 峰
  const r2 = rec(bjIso(2026, 8, 27, 21), { ms: 2000 }); // 非峰
  const rY = rec(bjIso(2026, 8, 26, 10)); // 昨天，应排除
  const r402 = rec(bjIso(2026, 8, 27, 11), { status: 402, prompt_tokens: 0, cache_miss_tokens: 0, total_tokens: 0, completion_tokens: 0 });
  const s = aggregateRange([r1, r2, rY, r402], "today", now);
  check("today count", s.count, 3);
  check("today count402", s.count402, 1);
  check("today prompt", s.p, 2e6);
  // r1 峰:1×2=2.0, r2 非峰:1, r402:0 → 3.0
  check("today cost", s.cost.toFixed(4), "3.0000");
  check("today chCost=0", s.chCost, 0);
  check("avgMs (无ms的402不计)", s.avgMs, 1500);
  check("maxMs", s.maxMs, 2000);
  check("buckets 数", s.buckets.length, 3); // 10/11/21 时
  check("recent[0] 最新 21:00", s.recent[0].ts, r2.ts);
  check("models 数", s.models.length, 1);
  check("model count", s.models[0].m.count, 3);
  check("model avgMs", s.models[0].m.avgMs, 1500);

  // 自定义周：rY（8/26 周三）与 r1/r2 同周 → 3 条
  const sw = aggregateCustom([r1, r2, rY], "2026-08-27", "week", );
  check("custom week count", sw.count, 3);
  const sm = aggregateCustom([r1, r2, rY], "2026-08-27", "month");
  check("custom month count", sm.count, 3);
  // 桶对齐北京日：r1 落在 08-27 第 10 时
  const HOUR = 3600000;
  const dayStart = Date.parse("2026-08-26T16:00:00.000Z");
  check("bucket r1 对齐 10 时", s.buckets.some((b) => b.start === dayStart + 10 * HOUR), true);
}

// ---------- 4. 图表数据 ----------
{
  const HOUR = 3600000;
  const bjDayStart = Date.parse("2026-08-26T16:00:00.000Z"); // 08-27 00:00 北京
  const mk = (start: number, over: Partial<Parameters<typeof buildChartPayload>[0][number]> = {}) => ({
    label: "x", start, cost: 0, tokens: 0, costCacheHit: 0, costCacheMiss: 0, costOutput: 0,
    tokCacheHit: 0, tokCacheMiss: 0, tokOutput: 0, avgMs: 0, ...over,
  });
  const buckets = [
    mk(bjDayStart + 10 * HOUR, { costCacheHit: 100, costCacheMiss: 50, costOutput: 200, avgMs: 1500 }),
  ];
  const chartWin = { start: bjDayStart, end: bjDayStart + 24 * HOUR };
  const p = buildChartPayload(buckets, "cost" as ChartKind, true, true, chartWin, [], false, true)!;
  check("labels 24 槽", p.labels.length, 24);
  check("label[10]=10", p.labels[10], "10");
  check("hit[10]", p.hit[10], 100);
  check("miss[10]", p.miss[10], 50);
  check("out[10]", p.out[10], 200);
  check("hit[0]=0", p.hit[0], 0);
  check("latency[10]", p.latency[10], 1500);
  check("latency[0]=null", p.latency[0], null);
  check("latencyOn", p.latencyOn, true);
  // tokens 模式
  const p2 = buildChartPayload(buckets, "tokens" as ChartKind, true, true, chartWin, [], false, false)!;
  check("tokens hit[10]=0（桶无 tok 值）", p2.hit[10], 0);
  check("latencyOn 关", p2.latencyOn, false);
  // 余额按小时平均
  const bal = [{ ts: bjDayStart + 10 * HOUR + HOUR / 2, cny: 10 }];
  const p3 = buildChartPayload(buckets, "cost" as ChartKind, true, true, chartWin, bal, true, false)!;
  check("balance[10]", p3.balance![10], 10);
  check("balance[0]=null", p3.balance![0], null);
  check("useTimeAxis 小时视图 false", p3.useTimeAxis, false);
  // 月视图：天柱 + 日号标签 + 独立时间轴
  const p4 = buildChartPayload(buckets, "cost" as ChartKind, false, false, chartWin, bal, true, false)!;
  check("month label[0]=日号27", p4.labels[0], "27");
  check("month useTimeAxis true", p4.useTimeAxis, true);
  check("month balance 是点数组", Array.isArray(p4.balance) && typeof p4.balance![0] === "object", true);
}

// ---------- 5. 货币 ----------
{
  check("cny 4位", fmtMoney(1.23456789, "cny", 6.74), "￥1.2346");
  check("usd 转换", fmtMoney(6.74, "usd", 6.74), "$1.0000");
  check("digits=2", fmtMoney(9.5, "cny", 6.74, 2), "￥9.50");
  check("moneyPair", moneyPair(1, 0.5, "cny", 6.74), "￥1.0000/￥0.5000");
  check("负数", fmtMoney(-1.5, "cny", 6.74, 2), "￥-1.50");
}

// ---------- 6. JSONL TailReader ----------
{
  const file = path.join(os.tmpdir(), `dsu-test-${Date.now()}.jsonl`);
  fs.rmSync(file, { force: true });
  const rec = { ts: bjIso(2026, 8, 27, 10), model: "m", prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cache_hit_tokens: 0, cache_miss_tokens: 0, stream: true, status: 200 };
  appendRecord(file, rec);
  const reader = new TailReader(file);
  check("首读 1 条", reader.readNew().length, 1);
  // 追加无效 JSON（无换行）→ 不应被消费
  fs.appendFileSync(file, "not-json{");
  check("半行不消费", reader.readNew().length, 0);
  // 补全换行 + 完整行
  fs.appendFileSync(file, '\n{"ts":"full","model":"m","prompt_tokens":1,"completion_tokens":1,"total_tokens":2,"cache_hit_tokens":0,"cache_miss_tokens":0,"stream":true,"status":200}\n');
  const got = reader.readNew();
  check("补全后读到完整行", got.length, 1);
  check("损坏行被跳过", got[0].ts, "full");
  // reset 重扫
  reader.reset();
  check("reset 重扫全部", reader.readNew().length, 2);
  fs.rmSync(file, { force: true });
}

// ---------- 7. i18n ----------
{
  check("zh 界面", isZh(), true);
  check("t 中文", t("cost"), "费用");
  check("t 占位替换", t("err402", { n: 3 }), "3 次 HTTP 402 —— 检测到余额不足");
  check("t 缺键返回 key", t("not_exist_key"), "not_exist_key");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
