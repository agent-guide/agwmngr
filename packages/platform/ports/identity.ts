export interface ManagerUserIdentity {
  id: number;
  username: string;
  active: boolean;
  platformAdmin: boolean;
  authorityEpoch: number;
}

export interface ManagerGatewayIdentity {
  id: string;
  active: boolean;
  authorityEpoch: number;
}

// Manager users remain the only editable human identity/password authority.
export interface IdentityDirectory {
  findUser(id: number): Promise<ManagerUserIdentity | null>;
  findUserByUsername(username: string): Promise<ManagerUserIdentity | null>;
  listUsers(): Promise<ManagerUserIdentity[]>;
  findGateway(id: string): Promise<ManagerGatewayIdentity | null>;
}
