
export enum TriageLevel {
  EMERGENCY = 'EMERGENCY',
  URGENT = 'URGENT',
  ROUTINE = 'ROUTINE',
  SELF_CARE = 'SELF_CARE'
}

export interface Provider {
  name: string;
  specialty: string;
  address: string;
  phone: string;
  website?: string;
  bookingUrl?: string;
  hours?: string;
  acceptedInsurance?: string[];
  distance?: string;
  verified: boolean;
  source?: string;
}

export interface TriageResult {
  level: TriageLevel;
  recommendation: string;
  specialtyNeeded?: string;
  reasonForReferral: string;
  summary: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface AssessmentData {
  ageRange?: string;
  chiefComplaint: string;
  duration?: string;
  severity?: number;
  redFlags?: string[];
  history?: string;
  zipCode?: string;
}

export interface Subscription {
  fullName: string;
  email: string;
  momoNumber: string;
}
