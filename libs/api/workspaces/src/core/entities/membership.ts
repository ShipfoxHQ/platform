export interface Membership {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}
