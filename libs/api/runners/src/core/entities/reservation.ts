export interface Reservation {
  id: string;
  workspaceId: string;
  provisionerId: string;
  requiredLabels: string[];
  count: number;
  kind: 'bound' | 'launch';
  createdAt: Date;
  expiresAt: Date;
}
