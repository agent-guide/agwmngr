export interface ManagerUserIdentity {
  id: number;
  username: string;
  active: boolean;
  platformAdmin: boolean;
}

// Manager users remain the only editable human identity/password authority.
export interface IdentityDirectory {
  findUser(id: number): Promise<ManagerUserIdentity | null>;
  listUsers(): Promise<ManagerUserIdentity[]>;
}
