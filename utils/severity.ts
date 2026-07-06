import i18n from '@/i18n';
import { SnoreAnalysis } from '@/utils/storage';
import { ThemeColors } from '@/constants/theme';

export function getSeverityColor(severity: SnoreAnalysis['severity'] | string, colors: ThemeColors): string {
  switch (severity) {
    case 'none':
      return colors.severity.none;
    case 'mild':
      return colors.severity.mild;
    case 'moderate':
      return colors.severity.moderate;
    case 'severe':
      return colors.severity.severe;
    default:
      return colors.severity.unknown;
  }
}

export function getSeverityText(severity: SnoreAnalysis['severity'] | string): string {
  switch (severity) {
    case 'none':
      return i18n.t('analysis.none');
    case 'mild':
      return i18n.t('analysis.mild');
    case 'moderate':
      return i18n.t('analysis.moderate');
    case 'severe':
      return i18n.t('analysis.severe');
    default:
      return i18n.t('analysis.unknown');
  }
}
