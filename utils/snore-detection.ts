import { DecibelDataPoint, SnoreAnalysis, SnoreEvent } from '@/utils/storage';

// 自动打鼾识别算法
//
// 原理：打鼾相比其他夜间噪音有两个显著特征：
// 1. 突出性：比当时的环境底噪高出一截（而不是超过某个固定分贝）
// 2. 节律性：跟随呼吸节奏，每 2~10 秒规律地重复一次，且会持续多次
//
// 算法流程：
// 1. 自适应基线：滚动窗口取低分位数作为环境底噪（自动适应安静/嘈杂环境）
// 2. 突发检测：高于基线一定分贝、持续 0.3~5 秒的响声记为一次"突发"
// 3. 节律判定：连续 4 次以上、间隔 2~10 秒且间隔规律的突发，判定为一段打鼾
// 4. 形态判定：呼噜声声时长相近、响度渐变、短响长停；
//    说话（短语忽长忽短、长响短停）和洗漱（响度乱跳）在这里被过滤
//
// 孤立的响声（关门、咳嗽）和持续的噪音（电视、马路、流水）也会被过滤掉。

// 检测算法版本：判定规则变化时 +1，已保存的分析结果会在后台按新版本重算
// v3: 相关性门槛加 durCv 前置条件，修复 4Hz 真呼噜被误杀成 0 的回归
export const DETECTION_ALGO_VERSION = 3;

export interface SnoreDetectionOptions {
  baselinePercentile: number; // 基线取分贝分布的低分位数
  prominenceDb: number;       // 突发需高于基线的分贝数
  minAbsoluteDb: number;      // 突发的最低绝对分贝（过滤极安静环境下的呼吸声）
  minBurstMs: number;         // 单次呼噜最短持续时间
  maxBurstMs: number;         // 单次呼噜最长持续时间（过滤持续噪音）
  minIntervalMs: number;      // 呼噜之间的最小间隔（起点到起点）
  maxIntervalMs: number;      // 呼噜之间的最大间隔
  minBurstsPerEpisode: number; // 构成一段打鼾所需的最少呼噜次数
  maxIntervalCv: number;      // 间隔的最大变异系数（标准差/均值），越小要求节律越规律
  smallGroupSize: number;     // 少于这个数的组视为"小组"，节律要求更严（样本少碰巧规律的概率高）
  maxIntervalCvSmall: number; // 小组的间隔变异系数上限（过滤对话里碰巧规律的几句话）
  maxDurationCv: number;      // 每声时长的变异系数上限（呼噜声声长短相近，说话短语忽长忽短）
  maxDutyCycle: number;       // 响声占时段的比例上限（呼噜短响长停，说话长响短停）
  maxDutyCycleDualPhase: number; // 双声打鼾（吸气+呼气）的占空比上限：两声/周期天然更高，
                                 // 且已通过强弱交替指纹确认，可放宽
  maxMedianPeakJumpDb: number; // 相邻两声峰值差的中位数上限（呼噜响度渐变，洗漱水声/碰撞声乱跳）
  maxDurationIntervalCorr: number; // 每声时长与到下一声间隔的相关系数上限。
                                   // 说话：说完长句才停顿，间隔=时长+停顿，强正相关；
                                   // 呼噜：时长恒定、间隔由呼吸决定，相关性≈0（双声打鼾为负）
  minDurationCvForCorrelation: number; // 时长变异低于此值时不启用相关性门槛：
                                       // 呼噜 durCv≈0.1，相关性是噪声；说话 durCv≈0.4，相关性真实
}

export const DEFAULT_DETECTION_OPTIONS: SnoreDetectionOptions = {
  baselinePercentile: 0.2,
  prominenceDb: 8,
  minAbsoluteDb: 38,
  minBurstMs: 300,
  // 3.5s：单声呼噜（吸气段）的生理上限再加余量；说话的长句、持续噪音在这里被排除，
  // 而且长句造成的"空洞"会推高剩余突发的间隔变异，进一步帮助节律门槛拦截对话
  maxBurstMs: 3500,
  minIntervalMs: 2000,
  maxIntervalMs: 10000,
  minBurstsPerEpisode: 4,
  maxIntervalCv: 0.25,
  smallGroupSize: 6,
  maxIntervalCvSmall: 0.2,
  maxDurationCv: 0.6,
  maxDutyCycle: 0.5,
  maxDutyCycleDualPhase: 0.65,
  maxMedianPeakJumpDb: 5,
  maxDurationIntervalCorr: 0.5,
  minDurationCvForCorrelation: 0.25,
};

// 一段连续的打鼾（由多次有节律的呼噜组成）
export interface SnoreEpisode {
  startTime: number;
  endTime: number;
  burstCount: number;
  confidence: number; // 0~1
}

export interface SnoreDetectionResult {
  events: SnoreEvent[];     // 每一次呼噜
  episodes: SnoreEpisode[]; // 每一段连续打鼾
}

// 突发响声（候选呼噜）
interface Burst {
  startTime: number;
  endTime: number;
  maxDecibel: number;
  peakProminence: number; // 峰值高于基线的分贝数
}

const BASELINE_BLOCK_MS = 30000;

function percentileOf(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[idx];
}

// 按 30 秒分块计算基线：每块的基线取本块及前后邻块（约 90 秒窗口）分贝的低分位数
function computeBaselines(data: DecibelDataPoint[], percentile: number): number[] {
  const lastTs = data[data.length - 1].timestamp;
  const blockCount = Math.floor(lastTs / BASELINE_BLOCK_MS) + 1;
  const blockValues: number[][] = Array.from({ length: blockCount }, () => []);
  const allValid: number[] = [];

  for (const point of data) {
    if (point.decibel <= 0) continue; // 0 表示 metering 数据无效
    const block = Math.floor(point.timestamp / BASELINE_BLOCK_MS);
    blockValues[block].push(point.decibel);
    allValid.push(point.decibel);
  }

  allValid.sort((a, b) => a - b);
  const globalBaseline = percentileOf(allValid, percentile);

  const baselines: number[] = new Array(blockCount);
  for (let i = 0; i < blockCount; i++) {
    const windowValues = [
      ...(blockValues[i - 1] || []),
      ...blockValues[i],
      ...(blockValues[i + 1] || []),
    ];
    if (windowValues.length < 5) {
      baselines[i] = globalBaseline;
    } else {
      windowValues.sort((a, b) => a - b);
      baselines[i] = percentileOf(windowValues, percentile);
    }
  }
  return baselines;
}

// 检测突发响声：高于基线 prominenceDb 的连续片段
function detectBursts(
  data: DecibelDataPoint[],
  baselines: number[],
  sampleIntervalMs: number,
  options: SnoreDetectionOptions
): Burst[] {
  const gapToleranceMs = Math.max(600, sampleIntervalMs * 1.5);
  const bursts: Burst[] = [];
  let current: (Burst & { lastActiveTs: number }) | null = null;

  const finalize = () => {
    if (!current) return;
    const duration = current.endTime - current.startTime;
    if (duration >= options.minBurstMs && duration <= options.maxBurstMs) {
      bursts.push({
        startTime: current.startTime,
        endTime: current.endTime,
        maxDecibel: current.maxDecibel,
        peakProminence: current.peakProminence,
      });
    }
    current = null;
  };

  for (const point of data) {
    const baseline = baselines[Math.floor(point.timestamp / BASELINE_BLOCK_MS)] ?? 0;
    const thresholdDb = Math.max(baseline + options.prominenceDb, options.minAbsoluteDb);
    if (point.decibel < thresholdDb) continue;

    const prominence = point.decibel - baseline;
    if (current && point.timestamp - current.lastActiveTs <= gapToleranceMs) {
      current.lastActiveTs = point.timestamp;
      current.endTime = point.timestamp + sampleIntervalMs;
      current.maxDecibel = Math.max(current.maxDecibel, point.decibel);
      current.peakProminence = Math.max(current.peakProminence, prominence);
    } else {
      finalize();
      current = {
        startTime: point.timestamp,
        endTime: point.timestamp + sampleIntervalMs,
        lastActiveTs: point.timestamp,
        maxDecibel: point.decibel,
        peakProminence: prominence,
      };
    }
  }
  finalize();
  return bursts;
}

// 合并间隔过近的突发（起点间隔小于 minIntervalMs 的视为同一次呼噜）
// 合并后超过 maxBurstMs 的会被剔除——持续的噪音（电视、马路）会在这里被过滤
function mergeCloseBursts(bursts: Burst[], options: SnoreDetectionOptions): Burst[] {
  const merged: Burst[] = [];
  for (const burst of bursts) {
    const prev = merged[merged.length - 1];
    if (prev && burst.startTime - prev.startTime < options.minIntervalMs) {
      prev.endTime = Math.max(prev.endTime, burst.endTime);
      prev.maxDecibel = Math.max(prev.maxDecibel, burst.maxDecibel);
      prev.peakProminence = Math.max(prev.peakProminence, burst.peakProminence);
    } else {
      merged.push({ ...burst });
    }
  }
  return merged.filter(b => b.endTime - b.startTime <= options.maxBurstMs);
}

// "双声折叠"参数：一次呼吸周期里吸气鼾（响）和呼气声（弱）都可能被检出，
// 导致呼噜次数翻倍。满足以下任一信号时把相邻两声折叠为一次呼噜：
const DUAL_PHASE_MAX_MEAN_INTERVAL_MS = 3000; // 间隔均值 <3s（呼吸 >20次/分，睡眠中不现实，必是半周期）
const DUAL_PHASE_LOUDNESS_GAP_DB = 4;         // 奇偶位强弱交替 ≥4dB（吸气响、呼气弱）
const DUAL_PHASE_PAIR_MAX_GAP_MS = 5000;      // 配对的两声起点间隔上限（须在同一呼吸周期内）

// 检测并折叠"每个呼吸周期两声"的模式
function collapseDualPhase(group: Burst[]): Burst[] {
  if (group.length < 4) return group;

  const intervals: number[] = [];
  for (let i = 1; i < group.length; i++) {
    intervals.push(group[i].startTime - group[i - 1].startTime);
  }
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

  // 奇偶位的响度均值（强弱交替时两组差异明显；随机波动时趋近于零）
  let evenSum = 0, evenCount = 0, oddSum = 0, oddCount = 0;
  group.forEach((b, i) => {
    if (i % 2 === 0) { evenSum += b.maxDecibel; evenCount++; }
    else { oddSum += b.maxDecibel; oddCount++; }
  });
  const evenMean = evenSum / evenCount;
  const oddMean = oddSum / oddCount;
  const loudnessAlternates = Math.abs(evenMean - oddMean) >= DUAL_PHASE_LOUDNESS_GAP_DB;

  if (meanInterval >= DUAL_PHASE_MAX_MEAN_INTERVAL_MS && !loudnessAlternates) {
    return group;
  }

  // 相位对齐：强弱交替时以"响的那组"作为每对的主声开头
  const start = loudnessAlternates && oddMean > evenMean ? 1 : 0;
  const collapsed: Burst[] = [];
  if (start === 1) collapsed.push(group[0]);
  let i = start;
  while (i < group.length) {
    const cur = group[i];
    const next = group[i + 1];
    if (next && next.startTime - cur.startTime <= DUAL_PHASE_PAIR_MAX_GAP_MS) {
      collapsed.push({
        startTime: cur.startTime,
        endTime: Math.max(cur.endTime, next.endTime),
        maxDecibel: Math.max(cur.maxDecibel, next.maxDecibel),
        peakProminence: Math.max(cur.peakProminence, next.peakProminence),
      });
      i += 2;
    } else {
      collapsed.push(cur);
      i += 1;
    }
  }
  return collapsed;
}

// 将突发按节律分组，判定打鼾段落
function groupIntoEpisodes(
  bursts: Burst[],
  sampleIntervalMs: number,
  options: SnoreDetectionOptions
): { events: SnoreEvent[]; episodes: SnoreEpisode[] } {
  const events: SnoreEvent[] = [];
  const episodes: SnoreEpisode[] = [];

  const evaluateGroup = (rawGroup: Burst[]) => {
    // 先折叠"吸气鼾+呼气声"的双声模式，避免一次呼噜计两次
    const group = collapseDualPhase(rawGroup);
    if (group.length < options.minBurstsPerEpisode) return;

    // 计算起点间隔的规律程度
    // 小组（如刚够 4 声、只有 3 个间隔）碰巧规律的概率高——对话里几句话的
    // 间隔常常就是 2~5 秒，所以声数不足时用更严的门槛
    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      intervals.push(group[i].startTime - group[i - 1].startTime);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const cvLimit = group.length >= options.smallGroupSize
      ? options.maxIntervalCv
      : options.maxIntervalCvSmall;
    if (cv > cvLimit) return;

    // 时长一致性：呼噜每声长短相近；说话短语忽长忽短（"嗯"和整句话混在一起）
    const durations = group.map((b) => b.endTime - b.startTime);
    const durMean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const durVariance = durations.reduce((a, b) => a + (b - durMean) ** 2, 0) / durations.length;
    const durCv = durMean > 0 ? Math.sqrt(durVariance) / durMean : 1;
    if (durCv > options.maxDurationCv) return;

    // 占空比：呼噜是短响长停（响声只占呼吸周期的一小段），说话是长响短停。
    // 按折叠前的原始突发计算——双声呼噜折叠后的时长横跨半个呼吸周期，直接算会虚高。
    // 双声打鼾每周期两声、占空比天然更高，但它已通过强弱交替/短间隔指纹确认，放宽上限。
    // 测量时长被采样粒度虚增约一个采样间隔，按净时长算——尤其旧的 1Hz 低频数据，
    // 每声虚增 1 秒，不修正会把真呼噜的占空比顶爆
    const wasCollapsed = group.length < rawGroup.length;
    const dutyLimit = wasCollapsed ? options.maxDutyCycleDualPhase : options.maxDutyCycle;
    const span = rawGroup[rawGroup.length - 1].endTime - rawGroup[0].startTime;
    let activeMs = 0;
    for (const b of rawGroup) {
      activeMs += Math.max(options.minBurstMs, b.endTime - b.startTime - sampleIntervalMs);
    }
    if (span > 0 && activeMs / span > dutyLimit) return;

    // 时长-间隔相关性：说话是"说完长句才停顿"，每声时长和到下一声的间隔强正相关；
    // 呼噜每声时长恒定、间隔由呼吸节律决定，两者无关。样本相关系数噪声随样本数减小
    // （σ≈1/√(n-1)），间隔少于 8 个时不判定，避免误伤真呼噜（小组另有更严的节律门槛）。
    // 用折叠前的原始突发计算，单边门槛（双声打鼾天然负相关，不受影响）。
    // 仅对高频数据启用：旧版 1Hz 数据的时长测量只剩整秒档位，量化误差会造出虚假相关。
    //
    // 关键前提 durCv > minDurationCvForCorrelation：呼噜每声长短几乎一致（durCv≈0.1），
    // 4Hz 采样下阈值穿越的零星抖动仍会让相关系数偶尔冲到 0.5~0.7（落进说话区间），
    // 一旦这样整段真呼噜会被误杀成 0——这正是"录完即时分析呼噜数为 0，重新分析又正常"
    // 的根因。说话的相关性来自短语长短真实变化（durCv≈0.4+），所以只有时长确有变化时
    // 才让这道门生效，用 durCv 把"真变化驱动的相关"和"噪声凑出的相关"分开。
    if (rawGroup.length >= 9 && sampleIntervalMs <= 500 && durCv > options.minDurationCvForCorrelation) {
      const n = rawGroup.length - 1;
      const durs: number[] = [];
      const gaps: number[] = [];
      for (let i = 0; i < n; i++) {
        durs.push(rawGroup[i].endTime - rawGroup[i].startTime);
        gaps.push(rawGroup[i + 1].startTime - rawGroup[i].startTime);
      }
      const dMean = durs.reduce((a, b) => a + b, 0) / n;
      const gMean = gaps.reduce((a, b) => a + b, 0) / n;
      let cov = 0, dVar = 0, gVar = 0;
      for (let i = 0; i < n; i++) {
        cov += (durs[i] - dMean) * (gaps[i] - gMean);
        dVar += (durs[i] - dMean) ** 2;
        gVar += (gaps[i] - gMean) ** 2;
      }
      const denom = Math.sqrt(dVar * gVar);
      const corr = denom > 0 ? cov / denom : 0;
      // 真假分布有重叠（真呼噜偶尔也会抽到偏高的 r），0.5 是漏报/误报的折中：
      // 段级漏报约 3%（对整晚汇总无感），说话误报降到 <10%
      if (corr > options.maxDurationIntervalCorr) return;
    }

    // 响度渐变：呼噜相邻两声的响度接近（整段可以慢慢变响/变轻），
    // 洗漱的水声、碰撞声响度乱跳。取相邻峰值差的中位数，对偶发大响声不敏感
    if (group.length >= 3) {
      const jumps: number[] = [];
      for (let i = 1; i < group.length; i++) {
        jumps.push(Math.abs(group[i].maxDecibel - group[i - 1].maxDecibel));
      }
      jumps.sort((a, b) => a - b);
      const medianJump = jumps[Math.floor(jumps.length / 2)];
      if (medianJump > options.maxMedianPeakJumpDb) return;
    }

    // 置信度：响度突出程度 + 节律规律程度 + 持续次数
    const avgProminence = group.reduce((a, b) => a + b.peakProminence, 0) / group.length;
    const prominenceScore = Math.min(1, Math.max(0, (avgProminence - options.prominenceDb) / 10));
    const regularityScore = Math.min(1, Math.max(0, 1 - cv / options.maxIntervalCv));
    const countScore = Math.min(1, (group.length - options.minBurstsPerEpisode) / 7);
    const confidence = Math.round(
      (0.25 + 0.75 * (0.45 * prominenceScore + 0.35 * regularityScore + 0.2 * countScore)) * 100
    ) / 100;

    episodes.push({
      startTime: group[0].startTime,
      endTime: group[group.length - 1].endTime,
      burstCount: group.length,
      confidence,
    });
    for (const burst of group) {
      events.push({
        startTime: burst.startTime,
        endTime: burst.endTime,
        maxDecibel: Math.round(burst.maxDecibel),
        confidence,
      });
    }
  };

  let group: Burst[] = [];
  for (const burst of bursts) {
    const prev = group[group.length - 1];
    if (prev && burst.startTime - prev.startTime <= options.maxIntervalMs) {
      group.push(burst);
    } else {
      evaluateGroup(group);
      group = [burst];
    }
  }
  evaluateGroup(group);

  return { events, episodes };
}

// 展示用的打鼾片段：把相邻的呼噜事件聚合成段，方便用户逐段播放查看
export interface SnoreSegment {
  startTime: number;
  endTime: number;
  eventCount: number; // 段内呼噜声数
  maxDecibel: number;
}

// 相邻事件间隔不超过 maxGapMs 的归为同一段
export function groupEventsIntoSegments(
  events: SnoreEvent[],
  maxGapMs: number = 15000
): SnoreSegment[] {
  const segments: SnoreSegment[] = [];
  for (const event of events) {
    const last = segments[segments.length - 1];
    if (last && event.startTime - last.endTime <= maxGapMs) {
      last.endTime = Math.max(last.endTime, event.endTime);
      last.eventCount++;
      last.maxDecibel = Math.max(last.maxDecibel, event.maxDecibel);
    } else {
      segments.push({
        startTime: event.startTime,
        endTime: event.endTime,
        eventCount: 1,
        maxDecibel: event.maxDecibel,
      });
    }
  }
  return segments;
}

// 自动检测打鼾事件
// 支持任意采样率（新录音 4Hz，旧录音 1Hz 也能工作，只是精度略低）
export function detectSnoreEvents(
  data: DecibelDataPoint[],
  options: Partial<SnoreDetectionOptions> = {}
): SnoreDetectionResult {
  const opts: SnoreDetectionOptions = { ...DEFAULT_DETECTION_OPTIONS, ...options };
  if (data.length < 10) {
    return { events: [], episodes: [] };
  }

  const spanMs = data[data.length - 1].timestamp - data[0].timestamp;
  const sampleIntervalMs = Math.max(50, Math.min(2000, spanMs / (data.length - 1)));

  const baselines = computeBaselines(data, opts.baselinePercentile);
  const bursts = mergeCloseBursts(detectBursts(data, baselines, sampleIntervalMs, opts), opts);
  return groupIntoEpisodes(bursts, sampleIntervalMs, opts);
}

// 从给定的呼噜事件列表生成分析摘要（不重新检测）
// 用于自动检测结果，以及用户手动删除误报片段后重算摘要
export function summarizeSnoreAnalysis(
  events: SnoreEvent[],
  maxDecibel: number,
  avgDecibel: number,
  totalDurationMs: number
): SnoreAnalysis {
  const snoreDuration = events.reduce((acc, e) => acc + (e.endTime - e.startTime), 0) / 1000;
  const avgSnoringDecibel = events.length > 0
    ? events.reduce((a, e) => a + e.maxDecibel, 0) / events.length
    : 0;

  // 严重程度判定规则与手动阈值分析保持一致
  let severity: SnoreAnalysis['severity'] = 'none';
  if (events.length > 0) {
    const totalDurationMin = totalDurationMs / 60000;
    const snorePercentage = totalDurationMin > 0 ? (snoreDuration / 60) / totalDurationMin * 100 : 0;

    if (snorePercentage > 30 || events.length > 50) {
      severity = 'severe';
    } else if (snorePercentage > 15 || events.length > 25) {
      severity = 'moderate';
    } else {
      severity = 'mild';
    }
  }

  return {
    hasSnoring: events.length > 0,
    snoreCount: events.length,
    snoreDuration: Math.round(snoreDuration),
    maxDecibel: Math.round(maxDecibel),
    avgDecibel: Math.round(avgDecibel),
    avgSnoringDecibel: Math.round(avgSnoringDecibel),
    severity,
    analyzedAt: Date.now(),
    snoreEvents: events,
    method: 'auto',
    algoVersion: DETECTION_ALGO_VERSION,
  };
}

// 基于自动检测结果生成完整分析报告
export function analyzeSnoringAuto(
  data: DecibelDataPoint[],
  totalDurationMs?: number
): SnoreAnalysis {
  const { events } = detectSnoreEvents(data);

  // 用循环算最大/平均值：整夜高频数据可达十几万点，
  // Math.max(...arr) 会把数组展开成函数参数、打爆调用栈（Hermes 上整夜录音必现）
  let maxDecibel = 0;
  let sum = 0;
  let validCount = 0;
  for (const point of data) {
    if (point.decibel <= 0) continue;
    if (point.decibel > maxDecibel) maxDecibel = point.decibel;
    sum += point.decibel;
    validCount++;
  }
  const avgDecibel = validCount > 0 ? sum / validCount : 0;

  const durationMs = totalDurationMs || data[data.length - 1]?.timestamp || 0;
  return summarizeSnoreAnalysis(events, maxDecibel, avgDecibel, durationMs);
}
