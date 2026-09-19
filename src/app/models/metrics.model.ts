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
  EXCELENTE: { label: 'Excelente', color: '#13875a', bg: '#e9f8f1', emoji: '' },
  BUENO:     { label: 'Bueno',     color: '#1267dd', bg: '#edf4ff', emoji: '' },
  REGULAR:   { label: 'Regular',   color: '#b36b12', bg: '#fff6e8', emoji: '' },
  RIESGO:    { label: 'Riesgo',    color: '#c2410c', bg: '#ffedd5', emoji: '' },
  CRITICO:   { label: 'Crítico',   color: '#b42318', bg: '#fff0ef', emoji: '' },
};

export const CONS_INFO: Record<ConsumptionTier, TierStyle> = {
  INTENSIVO: { label: 'Intensivo', color: '#9a3412', bg: '#ffedd5', emoji: '' },
  NORMAL:    { label: 'Normal',    color: '#1267dd', bg: '#edf4ff', emoji: '' },
  BAJO:      { label: 'Bajo',      color: '#526b80', bg: '#eef3f7', emoji: '' },
  INACTIVO:  { label: 'Inactivo',  color: '#667582', bg: '#f1f4f7', emoji: '' },
};

export function tierStyle(tier: CreditTier | string | null): TierStyle | null {
  if (!tier) return null;
  return TIER_INFO[tier as CreditTier] || null;
}

export function consStyle(tier: ConsumptionTier | string | null): TierStyle | null {
  if (!tier) return null;
  return CONS_INFO[tier as ConsumptionTier] || null;
}
