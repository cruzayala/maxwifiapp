export interface InternetPlan {
  id: number;
  nombre: string;
  tipo: string;
}

export interface PlanResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: InternetPlan[];
}

export interface Zone {
  id: number;
  nombre: string;
}

export interface ZoneResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Zone[];
}
