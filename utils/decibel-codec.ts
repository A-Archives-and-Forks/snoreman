import { DecibelDataPoint } from '@/utils/storage';

// 高频分贝数据的二进制编码
//
// 高频数据（250ms 一个采样）如果用 JSON 存，一晚 8 小时约 4MB，
// 会撑爆 Android AsyncStorage 的容量限制（默认 6MB，单条读取上限 ~2MB）。
// 这里改用二进制文件：采样间隔固定，时间戳按槽位隐含，分贝值 0~100 占 1 字节，
// 一晚 8 小时仅 ~113KB。
//
// 文件格式（小端）：
//   0~3  magic "SNRD"
//   4    版本号 (1)
//   5~6  采样间隔毫秒 (uint16)
//   7    保留
//   8~   每个采样槽 1 字节分贝值；0 表示该槽无有效数据（与 metering 无效值语义一致）

export const FULL_RATE_INTERVAL_MS = 250;

const MAGIC = [0x53, 0x4e, 0x52, 0x44]; // "SNRD"
const VERSION = 1;
const HEADER_SIZE = 8;

export function encodeDecibelData(
  data: DecibelDataPoint[],
  intervalMs: number = FULL_RATE_INTERVAL_MS
): Uint8Array {
  const lastTs = data.length > 0 ? data[data.length - 1].timestamp : 0;
  const slotCount = data.length > 0 ? Math.round(lastTs / intervalMs) + 1 : 0;

  const bytes = new Uint8Array(HEADER_SIZE + slotCount);
  bytes[0] = MAGIC[0];
  bytes[1] = MAGIC[1];
  bytes[2] = MAGIC[2];
  bytes[3] = MAGIC[3];
  bytes[4] = VERSION;
  bytes[5] = intervalMs & 0xff;
  bytes[6] = (intervalMs >> 8) & 0xff;
  bytes[7] = 0;

  // 按实际时间戳写入对应槽位（而非顺序写入），
  // 这样即使采样有抖动或中断，时间对齐也不会漂移；空槽保持 0
  for (const point of data) {
    const slot = Math.round(point.timestamp / intervalMs);
    if (slot < 0 || slot >= slotCount) continue;
    const value = Math.max(0, Math.min(100, Math.round(point.decibel)));
    // 多个采样落入同一槽位时取最大值，保留呼噜峰值
    if (value > bytes[HEADER_SIZE + slot]) {
      bytes[HEADER_SIZE + slot] = value;
    }
  }
  return bytes;
}

export function decodeDecibelData(bytes: Uint8Array): DecibelDataPoint[] | null {
  if (
    bytes.length < HEADER_SIZE ||
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3] ||
    bytes[4] !== VERSION
  ) {
    return null;
  }

  const intervalMs = bytes[5] | (bytes[6] << 8);
  if (intervalMs <= 0) return null;

  const data: DecibelDataPoint[] = [];
  for (let i = HEADER_SIZE; i < bytes.length; i++) {
    data.push({
      timestamp: (i - HEADER_SIZE) * intervalMs,
      decibel: bytes[i],
    });
  }
  return data;
}
