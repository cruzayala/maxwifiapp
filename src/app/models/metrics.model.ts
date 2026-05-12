// Modelos compartidos para Credit Score + Consumption Tier

export type CreditTier = 'EXCELENTE' | 'BUENO' | 'REGULAR' | 'RIESGO' | 'CRITICO';
export type ConsumptionTier = 'INTENSIVO' | 'NORMAL' | 'BAJO' | 'INACTIVO';

export interface ClientMetric {
  idServicio: number;
  creditScore: number | null;
  creditTier: CreditTier | null;
  consumptionTier: ConsumptionTier | null;
  consumptionMb30d: number | null;
  metricsUpdatedAt: string | null;
}

export interface TierStyle {
  label: string;
  color: string;
  bg: string;
  emoji: string;
}

export const TIER_INFO: Record<CreditTier, TierStyle> = {
  EXCELENTE: { label: 'EXCELENTE', color: '#15803d', bg: '#dcfce7', emoji: '🌟' },
  BUENO:     { label: 'BUENO',     color: '#0e7490', bg: '#cffafe', emoji: '✅' },
  REGULAR:   { label: 'REGULAR',   color: '#a16207', bg: '#fef3c7', emoji: '⚠️' },
  RIESGO:    { label: 'RIESGO',    color: '#c2410c', bg: '#ffedd5', emoji: '🟠' },
  CRITICO:   { label: 'CRÍTICO',   color: '#b91c1c', bg: '#fee2e2', emoji: '🔴' },
};

export const CONS_INFO: Record<ConsumptionTier, TierStyle> = {
  INTENSIVO: { label: 'INTENSIVO', color: '#7c2d12', bg: '#fed7aa', emoji: '🚀' },
  NORMAL:    { label: 'NORMAL',    color: '#1e40af', bg: '#dbeafe', emoji: '📊' },
  BAJO:      { label: 'BAJO',      color: '#475569', bg: '#f1f5f9', emoji: '💤' },
  INACTIVO:  { label: 'INACTIVO',  color: '#94a3b8', bg: '#e2e8f0', emoji: '⏸️' },
};

export function tierStyle(tier: CreditTier | string | null): TierStyle | null {
  if (!tier) return null;
  return TIER_INFO[tier as CreditTier] || null;
}

export function consStyle(tier: ConsumptionTier | string | null): TierStyle | null {
  if (!tier) return null;
  return CONS_INFO[tier as ConsumptionTier] || null;
}
