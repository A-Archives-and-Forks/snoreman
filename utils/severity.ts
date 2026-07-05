import i18n from '@/i18n';
import { SnoreAnalysis } from '@/utils/storage';
import { Palette } from '@/constants/theme';

export function getSeverityColor(severity: SnoreAnalysis['severity'] | string): string {
  switch (severity) {
    case 'none':
      return Palette.severity.none;
    case 'mild':
      return Palette.severity.mild;
    case 'moderate':
      return Palette.severity.moderate;
    case 'severe':
      return Palette.severity.severe;
    default:
      return Palette.severity.unknown;
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
