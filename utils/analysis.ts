import { SnoreAnalysis } from './storage';

// Simulated snore analysis - In a real app, this would use audio processing
// libraries or send the audio to a backend service for ML-based analysis
export async function analyzeSnoring(audioUri: string): Promise<SnoreAnalysis> {
  // Simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  // Generate mock analysis results
  // In production, this would use actual audio analysis:
  // - FFT to detect frequency patterns characteristic of snoring (typically 30-300 Hz)
  // - Machine learning model to classify snoring sounds
  // - Amplitude analysis to detect snoring events
  
  const hasSnoring = Math.random() > 0.3; // 70% chance of detecting snoring
  
  if (!hasSnoring) {
    return {
      hasSnoring: false,
      snoreCount: 0,
      snoreDuration: 0,
      severity: 'none',
      analyzedAt: Date.now(),
    };
  }
  
  const snoreCount = Math.floor(Math.random() * 50) + 5;
  const snoreDuration = Math.floor(Math.random() * 1800) + 60; // 1-30 minutes
  
  let severity: SnoreAnalysis['severity'];
  if (snoreCount < 10) {
    severity = 'mild';
  } else if (snoreCount < 25) {
    severity = 'moderate';
  } else {
    severity = 'severe';
  }
  
  return {
    hasSnoring: true,
    snoreCount,
    snoreDuration,
    severity,
    analyzedAt: Date.now(),
  };
}

export function getSeverityColor(severity: SnoreAnalysis['severity']): string {
  switch (severity) {
    case 'none':
      return '#4CAF50'; // Green
    case 'mild':
      return '#8BC34A'; // Light Green
    case 'moderate':
      return '#FF9800'; // Orange
    case 'severe':
      return '#F44336'; // Red
    default:
      return '#9E9E9E'; // Grey
  }
}

export function getSeverityText(severity: SnoreAnalysis['severity']): string {
  switch (severity) {
    case 'none':
      return '无打鼾';
    case 'mild':
      return '轻微';
    case 'moderate':
      return '中等';
    case 'severe':
      return '严重';
    default:
      return '未知';
  }
}
