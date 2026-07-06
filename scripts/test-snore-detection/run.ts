// 打鼾检测算法的合成数据测试
// 运行：npx tsx scripts/test-snore-detection/run.ts
// 生成呼噜/说话/洗漱等场景的 4Hz 分贝序列，检查检出与误报。

import { detectSnoreEvents } from '../../utils/snore-detection';
import type { DecibelDataPoint } from '../../utils/storage';

const SAMPLE_MS = 250;
const LEGACY_SAMPLE_MS = 1000; // 旧版录音的 1Hz 采样

// 简单的可复现伪随机数（不用 Math.random，保证每次结果一致）
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Sound {
  at: number;      // 开始时间 ms
  durMs: number;   // 持续 ms
  db: number;      // 峰值分贝
}

// 把若干响声叠加在底噪上，生成采样序列（默认 4Hz，可传 1000 模拟旧版 1Hz 数据）
function synthesize(totalMs: number, baseDb: number, sounds: Sound[], rng: () => number, sampleMs: number = SAMPLE_MS): DecibelDataPoint[] {
  const points: DecibelDataPoint[] = [];
  for (let t = 0; t < totalMs; t += sampleMs) {
    let db = baseDb + (rng() - 0.5) * 4; // 底噪 ±2dB 抖动
    for (const s of sounds) {
      if (t >= s.at && t < s.at + s.durMs) {
        db = Math.max(db, s.db + (rng() - 0.5) * 3);
      }
    }
    points.push({ timestamp: t, decibel: Math.round(db) });
  }
  return points;
}

// —— 场景生成器 ——

// 带升降包络的真实打鼾：每声用 sin 包络（安静→响→安静），并模拟采样时间戳抖动。
// 这是最接近真机 4Hz 采集的形态——阈值穿越点数随峰值起伏，会让"时长-间隔相关性"
// 偶尔冲高。用来守护回归：4Hz 真呼噜曾被相关性门槛误杀成 0（录完即时分析为 0）。
function realisticSnoring(totalMs: number, count: number, cycleMs: number, rng: () => number): DecibelDataPoint[] {
  const snores: { at: number; dur: number; peak: number }[] = [];
  for (let i = 0; i < count; i++) {
    snores.push({
      at: 5000 + i * cycleMs + (rng() - 0.5) * 500,
      dur: 1200 + (rng() - 0.5) * 300,
      peak: 55 + (rng() - 0.5) * 5,
    });
  }
  const points: DecibelDataPoint[] = [];
  let t = 250 + rng() * 200; // 启动延迟
  while (t < totalMs) {
    let db = 30 + (rng() - 0.5) * 4;
    for (const s of snores) {
      if (t >= s.at && t < s.at + s.dur) {
        const env = Math.sin(Math.PI * (t - s.at) / s.dur); // 升降包络
        db = Math.max(db, 30 + (s.peak - 30) * env + (rng() - 0.5) * 3);
      }
    }
    points.push({ timestamp: Math.round(t), decibel: Math.round(db) });
    t += SAMPLE_MS + (rng() - 0.5) * 40; // 采样抖动 ±20ms
  }
  return points;
}

// 规律打鼾：周期 cycleMs，每声 durMs，峰值 db（带微小抖动）
function snoring(startMs: number, count: number, cycleMs: number, durMs: number, db: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  for (let i = 0; i < count; i++) {
    sounds.push({
      at: startMs + i * cycleMs + (rng() - 0.5) * 600,
      durMs: durMs + (rng() - 0.5) * 300,
      db: db + (rng() - 0.5) * 4,
    });
  }
  return sounds;
}

// 双声打鼾：吸气鼾（响）+ 呼气声（弱），同一呼吸周期
function dualPhaseSnoring(startMs: number, cycles: number, cycleMs: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  for (let i = 0; i < cycles; i++) {
    const base = startMs + i * cycleMs + (rng() - 0.5) * 400;
    sounds.push({ at: base, durMs: 1200, db: 56 + (rng() - 0.5) * 3 });
    sounds.push({ at: base + 2400, durMs: 800, db: 47 + (rng() - 0.5) * 3 });
  }
  return sounds;
}

// 说话：短语时长 0.4~3.5s 随机、间隔 0.8~4s 随机、响度 55~65dB
function speech(startMs: number, totalMs: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  let t = startMs;
  while (t < startMs + totalMs) {
    const dur = 400 + rng() * 3100;
    sounds.push({ at: t, durMs: dur, db: 55 + rng() * 10 });
    t += dur + 800 + rng() * 3200;
  }
  return sounds;
}

// 节奏较规律的对话（最容易误报的形态）：句子 ~2.5s、间隔 ~4s
function regularSpeech(startMs: number, count: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  for (let i = 0; i < count; i++) {
    sounds.push({
      at: startMs + i * 4000 + (rng() - 0.5) * 500,
      durMs: 2300 + (rng() - 0.5) * 700,
      db: 58 + (rng() - 0.5) * 5,
    });
  }
  return sounds;
}

// 洗漱：水声、碰撞声、漱口声混杂——时长 0.3~3s、间隔 1~7s、响度 42~70dB 乱跳
function washing(startMs: number, totalMs: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  let t = startMs;
  while (t < startMs + totalMs) {
    const dur = 300 + rng() * 2700;
    sounds.push({ at: t, durMs: dur, db: 42 + rng() * 28 });
    t += dur + 1000 + rng() * 6000;
  }
  return sounds;
}

// —— 用例 ——

interface Case {
  name: string;
  data: DecibelDataPoint[];
  expectSnore: boolean;
  expectedCount?: [number, number]; // 期望呼噜数范围（可选）
}

const rng = makeRng(42);
const cases: Case[] = [
  {
    name: '规律打鼾 20 声（周期 4.5s）',
    data: synthesize(120000, 30, snoring(10000, 20, 4500, 1200, 55, rng), rng),
    expectSnore: true,
    expectedCount: [16, 22],
  },
  {
    name: '短暂打鼾 5 声',
    data: synthesize(60000, 30, snoring(10000, 5, 4500, 1200, 55, rng), rng),
    expectSnore: true,
    expectedCount: [4, 6],
  },
  {
    name: '双声打鼾 12 个周期（吸气响+呼气弱）',
    data: synthesize(120000, 30, dualPhaseSnoring(10000, 12, 5000, rng), rng),
    expectSnore: true,
    expectedCount: [9, 15],
  },
  {
    name: '嘈杂环境打鼾（底噪 45dB，鼾声 62dB）',
    data: synthesize(120000, 45, snoring(10000, 15, 5000, 1300, 62, rng), rng),
    expectSnore: true,
    expectedCount: [12, 17],
  },
  {
    name: '随机说话 2 分钟',
    data: synthesize(120000, 30, speech(5000, 110000, rng), rng),
    expectSnore: false,
  },
  {
    name: '节奏规律的对话 8 句',
    data: synthesize(60000, 30, regularSpeech(5000, 8, rng), rng),
    expectSnore: false,
  },
  {
    name: '洗漱 3 分钟（水声/碰撞声乱跳）',
    data: synthesize(180000, 32, washing(5000, 170000, rng), rng),
    expectSnore: false,
  },
  {
    name: '纯底噪 2 分钟',
    data: synthesize(120000, 30, [], rng),
    expectSnore: false,
  },
  {
    name: '旧版 1Hz 数据的打鼾 15 声（周期 5s）',
    data: synthesize(120000, 30, snoring(10000, 15, 5000, 1200, 55, rng), rng, LEGACY_SAMPLE_MS),
    expectSnore: true,
  },
];

// 呼吸周期缓慢漂移的打鼾（整晚节奏 4s → 6s 渐变），防止节律门槛收太紧误伤真呼噜
function driftingSnoring(startMs: number, count: number, rng: () => number): Sound[] {
  const sounds: Sound[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    const cycle = 4000 + (i / count) * 2000; // 4s 渐变到 6s
    sounds.push({ at: t + (rng() - 0.5) * 500, durMs: 1200 + (rng() - 0.5) * 300, db: 55 + (rng() - 0.5) * 4 });
    t += cycle;
  }
  return sounds;
}

let failed = 0;
for (const c of cases) {
  const { events, episodes } = detectSnoreEvents(c.data);
  const detected = events.length > 0;
  const countOk = !c.expectedCount || (events.length >= c.expectedCount[0] && events.length <= c.expectedCount[1]);
  const pass = detected === c.expectSnore && countOk;
  if (!pass) failed++;
  const conf = episodes.length > 0 ? ` conf=${episodes.map(e => e.confidence).join(',')}` : '';
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${c.name}: ${events.length} 声 / ${episodes.length} 段${conf}` +
    (c.expectedCount ? `（期望 ${c.expectedCount[0]}~${c.expectedCount[1]} 声）` : `（期望${c.expectSnore ? '检出' : '不检出'}）`)
  );
}

// 多种子扫描：统计各场景的误报/漏报率，避免单个种子碰巧通过
const SEEDS = 30;
const sweeps: { name: string; make: (r: () => number) => DecibelDataPoint[]; expectSnore: boolean }[] = [
  { name: '随机说话 2 分钟', make: (r) => synthesize(120000, 30, speech(5000, 110000, r), r), expectSnore: false },
  { name: '节奏规律的对话 8 句', make: (r) => synthesize(60000, 30, regularSpeech(5000, 8, r), r), expectSnore: false },
  { name: '洗漱 3 分钟', make: (r) => synthesize(180000, 32, washing(5000, 170000, r), r), expectSnore: false },
  { name: '规律打鼾 20 声', make: (r) => synthesize(120000, 30, snoring(10000, 20, 4500, 1200, 55, r), r), expectSnore: true },
  { name: '双声打鼾 12 周期', make: (r) => synthesize(120000, 30, dualPhaseSnoring(10000, 12, 5000, r), r), expectSnore: true },
  { name: '周期漂移打鼾 30 声（4s→6s）', make: (r) => synthesize(180000, 30, driftingSnoring(10000, 30, r), r), expectSnore: true },
  { name: '旧版 1Hz 数据的打鼾 15 声', make: (r) => synthesize(120000, 30, snoring(10000, 15, 5000, 1200, 55, r), r, LEGACY_SAMPLE_MS), expectSnore: true },
  // 回归守护：真实包络 4Hz 打鼾必须稳定检出（曾被时长-间隔相关性门槛误杀成 0）
  { name: '真实包络 4Hz 打鼾 18 声', make: (r) => realisticSnoring(90000, 18, 4500, r), expectSnore: true },
  { name: '真实包络 4Hz 打鼾 30 声', make: (r) => realisticSnoring(150000, 30, 4500, r), expectSnore: true },
];

console.log(`\n—— 多种子扫描（${SEEDS} 个种子）——`);
for (const s of sweeps) {
  let wrong = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = makeRng(seed * 7919);
    const { events } = detectSnoreEvents(s.make(r));
    if ((events.length > 0) !== s.expectSnore) wrong++;
  }
  const rate = ((wrong / SEEDS) * 100).toFixed(0);
  // 误报容许 ≤10%；漏报容许 ≤5%——相关性门槛与真呼噜分布有少量重叠（见 snore-detection.ts），
  // 一晚几十段呼噜丢一段对汇总无感，换取说话/洗漱误报大幅下降
  const ok = wrong <= Math.ceil(SEEDS * (s.expectSnore ? 0.05 : 0.1));
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}: ${s.expectSnore ? '漏报' : '误报'} ${wrong}/${SEEDS} (${rate}%)`);
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 个用例失败`);
process.exit(failed === 0 ? 0 : 1);
