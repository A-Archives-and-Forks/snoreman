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
//
// 孤立的响声（关门、咳嗽、说话）和持续的噪音（电视、马路）都会被过滤掉。

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
}

export const DEFAULT_DETECTION_OPTIONS: SnoreDetectionOptions = {
  baselinePercentile: 0.2,
  prominenceDb: 8,
  minAbsoluteDb: 38,
  minBurstMs: 300,
  maxBurstMs: 5000,
  minIntervalMs: 2000,
  maxIntervalMs: 10000,
  minBurstsPerEpisode: 4,
  maxIntervalCv: 0.35,
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

// 将突发按节律分组，判定打鼾段落
function groupIntoEpisodes(
  bursts: Burst[],
  options: SnoreDetectionOptions
): { events: SnoreEvent[]; episodes: SnoreEpisode[] } {
  const events: SnoreEvent[] = [];
  const episodes: SnoreEpisode[] = [];

  const evaluateGroup = (group: Burst[]) => {
    if (group.length < options.minBurstsPerEpisode) return;

    // 计算起点间隔的规律程度
    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      intervals.push(group[i].startTime - group[i - 1].startTime);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    if (cv > options.maxIntervalCv) return;

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
  return groupIntoEpisodes(bursts, opts);
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
